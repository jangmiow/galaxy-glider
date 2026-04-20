import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { generateName, saveDiscovery, type Discovery } from "@/lib/journal";
import {
  makeBarrenMaterial,
  makeGasGiantMaterial,
  makeIcyMaterial,
  makeLavaMaterial,
  makeOceanMaterial,
  makeRockyMaterial,
  tickPlanetUniforms,
  type PlanetKind,
} from "./planetShaders";

type Body = {
  mesh: THREE.Mesh;
  type: Discovery["type"];
  size: number;
  color: string;
  id: string;
  name: string;
  scanned: boolean;
  flare?: THREE.Sprite;
  isStar?: boolean;
  // Custom shader on the planet surface (when present, drives uniforms each frame).
  shaderMat?: THREE.ShaderMaterial;
  // Override sun source for shading (defaults to scene origin = Sol).
  sunSource?: THREE.Object3D;
  // Seconds the body has been held within the aim cone (for lock-on scan).
  aimTime?: number;
  // Optional orbit around a parent body (used for moons).
  orbit?: {
    parent: THREE.Object3D;
    radius: number;
    speed: number; // radians per second
    phase: number; // initial angle
    tilt: number; // inclination (radians)
  };
};

export type SceneCallbacks = {
  onDiscovery: (d: Discovery) => void;
  onScanProgress: (info: { name: string; progress: number } | null) => void;
  onOrbCollected: () => void;
};

const TYPE_COLORS: Record<Discovery["type"], string[]> = {
  planet: ["#6aa8ff", "#a86aff", "#ffaa6a", "#88dd88", "#dd6688"],
  "ringed-planet": ["#e8c97a", "#c9a86a", "#9aa8e8"],
  moon: ["#c8c0b4", "#9a948a", "#d8d0c0"],
  star: ["#ffe6a0", "#ffd070"],
  "blue-giant": ["#9ad0ff", "#bce0ff"],
  "red-dwarf": ["#ff7060", "#e85040"],
};

function randType(rng: () => number): Discovery["type"] {
  const r = rng();
  if (r < 0.55) return "planet";
  if (r < 0.7) return "ringed-planet";
  if (r < 0.85) return "star";
  if (r < 0.95) return "blue-giant";
  return "red-dwarf";
}

// Simple seeded RNG
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Legacy 2D canvas planet/cloud texture helpers were removed in favor of the
// GLSL shader pipeline in `./planetShaders.ts` (see `addPlanetBody`).


function makeRadialTexture(color: string, innerAlpha = 0.9, falloff = 1): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const c = new THREE.Color(color);
  const r = (c.r * 255) | 0, g = (c.g * 255) | 0, b = (c.b * 255) | 0;
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},${innerAlpha})`);
  grad.addColorStop(0.4 * falloff, `rgba(${r},${g},${b},${innerAlpha * 0.35})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// Banded ring texture: radial bands of varying density/alpha with a Cassini-style gap.
function makeRingTexture(baseColor: string, rng: () => number): THREE.CanvasTexture {
  const W = 512;
  const H = 32;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const base = new THREE.Color(baseColor);
  const tintA = base.clone().offsetHSL((rng() - 0.5) * 0.08, 0, 0.05);
  const tintB = base.clone().offsetHSL((rng() - 0.5) * 0.08, -0.1, -0.1);
  const shades = [base, tintA, tintB];
  const layers = 3 + Math.floor(rng() * 3);
  const freqs: number[] = [];
  const phases: number[] = [];
  const amps: number[] = [];
  for (let i = 0; i < layers; i++) {
    freqs.push(8 + rng() * 60);
    phases.push(rng() * Math.PI * 2);
    amps.push(0.35 + rng() * 0.65);
  }
  const gapPos = 0.35 + rng() * 0.3;
  const gapWidth = 0.02 + rng() * 0.05;
  const innerFade = 0.04 + rng() * 0.06;
  const outerFade = 0.06 + rng() * 0.08;

  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    let n = 0;
    let ampSum = 0;
    for (let i = 0; i < layers; i++) {
      n += Math.sin(u * freqs[i] + phases[i]) * amps[i];
      ampSum += amps[i];
    }
    n = n / ampSum;
    let alpha = 0.5 + 0.5 * n;
    alpha = Math.pow(alpha, 1.4);
    const gapDist = Math.abs(u - gapPos);
    if (gapDist < gapWidth) alpha *= gapDist / gapWidth;
    if (u < innerFade) alpha *= u / innerFade;
    if (u > 1 - outerFade) alpha *= (1 - u) / outerFade;
    const shade = shades[Math.floor((Math.sin(u * 23.7 + phases[0]) * 0.5 + 0.5) * shades.length) % shades.length];
    const r = (shade.r * 255) | 0;
    const g = (shade.g * 255) | 0;
    const b = (shade.b * 255) | 0;
    const a = Math.max(0, Math.min(1, alpha)) * 255;
    for (let y = 0; y < H; y++) {
      const idx = (y * W + x) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// Cross/anamorphic streak texture for lens flare.
function makeFlareStreakTexture(color: string): THREE.CanvasTexture {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const c = new THREE.Color(color);
  const r = (c.r * 255) | 0, g = (c.g * 255) | 0, b = (c.b * 255) | 0;
  // Soft center
  const grad = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.15, `rgba(${r},${g},${b},0.3)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // Horizontal streak
  const hStreak = ctx.createLinearGradient(0, S/2 - 4, 0, S/2 + 4);
  hStreak.addColorStop(0, `rgba(${r},${g},${b},0)`);
  hStreak.addColorStop(0.5, `rgba(255,255,255,0.9)`);
  hStreak.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = hStreak;
  ctx.fillRect(0, S/2 - 4, S, 8);
  // Vertical streak
  const vStreak = ctx.createLinearGradient(S/2 - 3, 0, S/2 + 3, 0);
  vStreak.addColorStop(0, `rgba(${r},${g},${b},0)`);
  vStreak.addColorStop(0.5, `rgba(255,255,255,0.7)`);
  vStreak.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = vStreak;
  ctx.fillRect(S/2 - 3, 0, 6, S);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export class SpaceScene {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ship: THREE.Object3D;
  bodies: Body[] = [];
  orbs: THREE.Mesh[] = [];
  starField!: THREE.Points;
  warpStars!: THREE.Points;
  dustField!: THREE.Points;

  velocity = 0;
  thrust = 0;
  pitch = 0;
  yaw = 0;
  roll = 0;
  warpCharge = 0;
  isWarping = false;
  warpTimer = 0;
  boost = 1;
  paused = false;
  // Bloom: base strength captured at init; spiked during warp jumps for a cinematic flash.
  bloomBase = 0.9;
  bloomBoost = 0;

  // Inputs
  mouseX = 0;
  mouseY = 0;
  keys = new Set<string>();

  callbacks: SceneCallbacks;
  systemSeed = 1;

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setClearColor(0x000308);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000308, 0.0008);

    this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 5000);

    // Postprocessing: bloom for stars and orbs
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.9, // strength
      0.85, // radius
      0.2, // threshold — only bright pixels (stars/orbs/coronas) bloom
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.ship = new THREE.Object3D();
    this.ship.add(this.camera);
    this.scene.add(this.ship);

    this.buildStarfield();
    this.buildWarpField();
    this.buildDustField();
    this.buildNebulae();
    this.buildSolSystem();

    // Lights
    const ambient = new THREE.AmbientLight(0x222244, 0.6);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeebb, 1.0);
    sun.position.set(100, 50, 100);
    this.scene.add(sun);
  }

  buildStarfield() {
    // Layer 1: bright nearer stars
    const count = 9000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 800 + Math.random() * 1500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const t = Math.random();
      const b = 0.7 + Math.random() * 0.3;
      if (t < 0.7) { col[i*3] = b; col[i*3+1] = b; col[i*3+2] = b; }
      else if (t < 0.9) { col[i*3] = 0.6*b; col[i*3+1] = 0.8*b; col[i*3+2] = b; }
      else { col[i*3] = b; col[i*3+1] = 0.8*b; col[i*3+2] = 0.5*b; }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.8, vertexColors: true, sizeAttenuation: true, transparent: true, fog: false });
    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);

    // Layer 2: very distant dim dust stars to fill the void (no fog, no size attenuation)
    const farCount = 18000;
    const farGeo = new THREE.BufferGeometry();
    const farPos = new Float32Array(farCount * 3);
    const farCol = new Float32Array(farCount * 3);
    for (let i = 0; i < farCount; i++) {
      const r = 2400 + Math.random() * 1200;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      farPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      farPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      farPos[i * 3 + 2] = r * Math.cos(phi);
      const b = 0.25 + Math.random() * 0.4;
      const t = Math.random();
      if (t < 0.75) { farCol[i*3] = b; farCol[i*3+1] = b; farCol[i*3+2] = b; }
      else if (t < 0.92) { farCol[i*3] = 0.5*b; farCol[i*3+1] = 0.7*b; farCol[i*3+2] = b; }
      else { farCol[i*3] = b; farCol[i*3+1] = 0.7*b; farCol[i*3+2] = 0.45*b; }
    }
    farGeo.setAttribute("position", new THREE.BufferAttribute(farPos, 3));
    farGeo.setAttribute("color", new THREE.BufferAttribute(farCol, 3));
    const farMat = new THREE.PointsMaterial({
      size: 0.9,
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    });
    const farStars = new THREE.Points(farGeo, farMat);
    this.scene.add(farStars);

    // Reduce fog density so distant stars stay visible
    this.scene.fog = new THREE.FogExp2(0x000308, 0.00035);
  }

  buildWarpField() {
    const count = 1500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 200;
      pos[i * 3 + 2] = -Math.random() * 800;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaaddff, size: 2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.warpStars = new THREE.Points(geo, mat);
    this.warpStars.visible = false;
    this.camera.add(this.warpStars);
  }

  /**
   * Cockpit-relative dust particles. They live in camera space inside a small box
   * around the ship and are recycled when they exit the volume. The update loop
   * streaks them backward proportional to current velocity for a parallax feel.
   */
  buildDustField() {
    // Far fewer, smaller, dimmer particles — meant to read as faint cockpit motes
    // that streak only when moving fast. Previously this looked like fog.
    const count = 180;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const HALF_X = 120;
    const HALF_Y = 80;
    const Z_NEAR = -260; // ahead of camera
    const Z_FAR = 40;    // slightly behind
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * HALF_X * 2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * HALF_Y * 2;
      pos[i * 3 + 2] = Z_NEAR + Math.random() * (Z_FAR - Z_NEAR);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8aa8d0,
      size: 0.6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    this.dustField = new THREE.Points(geo, mat);
    this.dustField.frustumCulled = false;
    this.camera.add(this.dustField);
  }

  buildNebulae() {
    const colors = [0x4466aa, 0xaa4466, 0x6644aa, 0xaa8844, 0x335577, 0x884466];
    for (let i = 0; i < 16; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      // Start fully transparent so corners outside the circle have alpha=0 AND rgb=0
      ctx.clearRect(0, 0, 256, 256);
      const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      const c = colors[i % colors.length];
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      // Circular fill avoids opaque corner artifacts under additive blending
      ctx.beginPath();
      ctx.arc(128, 128, 128, 0, Math.PI * 2);
      ctx.fill();
      const tex = new THREE.CanvasTexture(canvas);
      tex.premultiplyAlpha = true;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sprite = new THREE.Sprite(mat);
      const r2 = 600 + Math.random() * 600;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      sprite.position.set(r2 * Math.sin(ph) * Math.cos(th), r2 * Math.sin(ph) * Math.sin(th), r2 * Math.cos(ph));
      const s = 200 + Math.random() * 400;
      sprite.scale.set(s, s, 1);
      this.scene.add(sprite);
    }
  }

  clearSystem() {
    for (const b of this.bodies) {
      this.scene.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose?.();
      b.mesh.geometry.dispose();
    }
    this.bodies = [];
    for (const o of this.orbs) {
      this.scene.remove(o);
      (o.material as THREE.Material).dispose?.();
      o.geometry.dispose();
    }
    this.orbs = [];
  }

  /**
   * Build a single planet/star body and add it to the scene + bodies array.
   * Centralizes shader material selection, atmosphere, rings, and clouds.
   */
  private addPlanetBody(config: {
    id: string;
    name: string;
    type: Discovery["type"];
    kind: PlanetKind | "star";
    size: number;
    color: string;
    accentColor?: string;
    atmoColor?: string;
    position: THREE.Vector3;
    rings?: { inner: number; outer: number; tilt: number; color?: string };
    cloudiness?: number;
    seed?: number;
    spin?: number;
  }) {
    const seed = config.seed ?? Math.random() * 100;
    const accent = config.accentColor ?? config.color;
    const atmo = config.atmoColor ?? config.color;
    const isStar = config.kind === "star";
    const geo = new THREE.SphereGeometry(config.size, isStar ? 48 : 64, isStar ? 32 : 48);

    let mat: THREE.Material;
    let shaderMat: THREE.ShaderMaterial | undefined;
    if (isStar) {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(config.color) });
    } else {
      switch (config.kind) {
        case "ocean":
          shaderMat = makeOceanMaterial({
            oceanColor: config.color,
            landColor: accent,
            atmo,
            seed,
            cloudiness: config.cloudiness ?? 0.55,
          });
          break;
        case "gas":
          shaderMat = makeGasGiantMaterial({ base: config.color, accent, atmo, seed });
          break;
        case "icy":
          shaderMat = makeIcyMaterial({ base: config.color, accent, atmo, seed });
          break;
        case "lava":
          shaderMat = makeLavaMaterial({ base: config.color, accent, atmo, seed });
          break;
        case "barren":
          shaderMat = makeBarrenMaterial({ base: config.color, accent, seed });
          break;
        case "ringed":
          shaderMat = makeGasGiantMaterial({ base: config.color, accent, atmo, seed, bandStrength: 0.85 });
          break;
        case "rocky":
        default:
          shaderMat = makeRockyMaterial({
            base: config.color, accent, atmo, seed,
            cloudiness: config.cloudiness,
          });
      }
      mat = shaderMat;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(config.position);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    (mesh as THREE.Mesh & { _spin?: number })._spin = config.spin ?? (Math.random() - 0.5) * 0.05;

    let flareSprite: THREE.Sprite | undefined;

    if (isStar) {
      const coronaTex = makeRadialTexture(config.color, 0.9);
      const corona = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: coronaTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      corona.scale.set(config.size * 6, config.size * 6, 1);
      mesh.add(corona);

      const flareTex = makeFlareStreakTexture(config.color);
      flareSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flareTex,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
          fog: false,
        }),
      );
      flareSprite.scale.set(config.size * 14, config.size * 14, 1);
      flareSprite.renderOrder = 999;
      mesh.add(flareSprite);

      const light = new THREE.PointLight(new THREE.Color(config.color), 1.4, 4000);
      mesh.add(light);
    }

    if (config.rings) {
      const innerR = config.rings.inner;
      const outerR = config.rings.outer;
      const ringGeom = new THREE.RingGeometry(innerR, outerR, 192, 1);
      const pos = ringGeom.attributes.position;
      const uv = ringGeom.attributes.uv;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        const r = Math.sqrt(x * x + y * y);
        const u = (r - innerR) / (outerR - innerR);
        const a = Math.atan2(y, x) / (Math.PI * 2) + 0.5;
        uv.setXY(v, u, a);
      }
      uv.needsUpdate = true;
      const ringTex = makeRingTexture(config.rings.color ?? config.color, () => Math.random());
      const ring = new THREE.Mesh(
        ringGeom,
        new THREE.MeshBasicMaterial({
          map: ringTex,
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          fog: false,
        }),
      );
      ring.rotation.x = Math.PI / 2 - config.rings.tilt;
      mesh.add(ring);
    }

    this.scene.add(mesh);
    this.bodies.push({
      mesh,
      type: config.type,
      size: config.size,
      color: config.color,
      id: config.id,
      name: config.name,
      scanned: false,
      flare: flareSprite,
      isStar,
      shaderMat,
    });
  }

  /**
   * Add a small moon orbiting a parent planet body. The moon is a fully scannable
   * Body in its own right, gets its own shader, and is positioned each frame by
   * the orbit data in the update loop. `kind` controls its visual archetype.
   */
  private addMoon(config: {
    id: string;
    name: string;
    parent: Body;
    size: number;
    color: string;
    accentColor?: string;
    kind?: "barren" | "rocky" | "icy";
    radius: number; // orbital radius from parent center
    speed?: number; // radians/sec; defaults to a slow drift
    phase?: number; // initial angle
    tilt?: number; // orbital inclination in radians
    seed?: number;
  }) {
    const kind = config.kind ?? "barren";
    const seed = config.seed ?? Math.random() * 100;
    const accent = config.accentColor ?? config.color;
    const geo = new THREE.SphereGeometry(config.size, 32, 24);

    let shaderMat: THREE.ShaderMaterial;
    switch (kind) {
      case "icy":
        shaderMat = makeIcyMaterial({ base: config.color, accent, atmo: accent, seed });
        break;
      case "rocky":
        shaderMat = makeRockyMaterial({ base: config.color, accent, atmo: accent, seed });
        break;
      case "barren":
      default:
        shaderMat = makeBarrenMaterial({ base: config.color, accent, seed });
    }

    const mesh = new THREE.Mesh(geo, shaderMat);
    // Initial position computed by orbit; placeholder until first update tick.
    mesh.position.copy(config.parent.mesh.position);
    (mesh as THREE.Mesh & { _spin?: number })._spin = (Math.random() - 0.5) * 0.08;
    this.scene.add(mesh);

    this.bodies.push({
      mesh,
      type: "moon",
      size: config.size,
      color: config.color,
      id: config.id,
      name: config.name,
      scanned: false,
      shaderMat,
      orbit: {
        parent: config.parent.mesh,
        radius: config.radius,
        speed: config.speed ?? 0.15,
        phase: config.phase ?? Math.random() * Math.PI * 2,
        tilt: config.tilt ?? (Math.random() - 0.5) * 0.5,
      },
    });
  }

  /** Hand-authored Sol system: Sun + 8 planets at scaled distances. */
  buildSolSystem() {
    this.clearSystem();
    this.systemSeed = 0;

    this.addPlanetBody({
      id: "sol-sun", name: "Sol", type: "star", kind: "star",
      size: 80, color: "#fff2c0",
      position: new THREE.Vector3(0, 0, 0), spin: 0.01,
    });

    const planets: Array<Parameters<SpaceScene["addPlanetBody"]>[0]> = [
      { id: "sol-mercury", name: "Mercury", type: "planet", kind: "barren",
        size: 4, color: "#9a8b7a", accentColor: "#5c4f44",
        position: new THREE.Vector3(180, 0, 0), seed: 1.1 },
      { id: "sol-venus", name: "Venus", type: "planet", kind: "lava",
        size: 7, color: "#d9a460", accentColor: "#7c5828", atmoColor: "#ffd089",
        position: new THREE.Vector3(0, 4, 240), seed: 2.2 },
      { id: "sol-earth", name: "Earth", type: "planet", kind: "ocean",
        size: 7.5, color: "#1c5cb8", accentColor: "#3a8a3c", atmoColor: "#7ab8ff",
        cloudiness: 0.6,
        position: new THREE.Vector3(-310, -2, 80), seed: 3.3 },
      { id: "sol-mars", name: "Mars", type: "planet", kind: "rocky",
        size: 5.5, color: "#c1543a", accentColor: "#7a3322", atmoColor: "#ff9070",
        cloudiness: 0.25,
        position: new THREE.Vector3(120, 8, -340), seed: 4.4 },
      { id: "sol-jupiter", name: "Jupiter", type: "planet", kind: "gas",
        size: 28, color: "#caa074", accentColor: "#7d4f30", atmoColor: "#ffd9a8",
        position: new THREE.Vector3(-480, 0, -380), seed: 5.5 },
      { id: "sol-saturn", name: "Saturn", type: "ringed-planet", kind: "ringed",
        size: 24, color: "#e0c084", accentColor: "#9a7438", atmoColor: "#ffe6b0",
        position: new THREE.Vector3(620, -10, 220),
        rings: { inner: 38, outer: 70, tilt: 0.45, color: "#d8c89c" }, seed: 6.6 },
      { id: "sol-uranus", name: "Uranus", type: "planet", kind: "icy",
        size: 14, color: "#a8e0e0", accentColor: "#5cb0c0", atmoColor: "#cdf0ff",
        position: new THREE.Vector3(-720, 30, 540), seed: 7.7 },
      { id: "sol-neptune", name: "Neptune", type: "planet", kind: "icy",
        size: 13.5, color: "#3859d8", accentColor: "#1d2c80", atmoColor: "#7090ff",
        position: new THREE.Vector3(820, -40, -680), seed: 8.8 },
    ];
    for (const p of planets) this.addPlanetBody(p);

    // Attach hand-picked moons to a few notable planets so the journal can log them.
    const findBody = (id: string) => this.bodies.find((b) => b.id === id);
    const earth = findBody("sol-earth");
    if (earth) {
      this.addMoon({ id: "sol-luna", name: "Luna", parent: earth,
        size: 2.2, color: "#cfc8b8", accentColor: "#807a6c", kind: "barren",
        radius: 18, speed: 0.35, seed: 11 });
    }
    const mars = findBody("sol-mars");
    if (mars) {
      this.addMoon({ id: "sol-phobos", name: "Phobos", parent: mars,
        size: 1.1, color: "#8a7a68", kind: "barren",
        radius: 12, speed: 0.7, phase: 0.2, seed: 12 });
      this.addMoon({ id: "sol-deimos", name: "Deimos", parent: mars,
        size: 0.9, color: "#9a8a78", kind: "barren",
        radius: 17, speed: 0.45, phase: 2.4, seed: 13 });
    }
    const jupiter = findBody("sol-jupiter");
    if (jupiter) {
      this.addMoon({ id: "sol-io", name: "Io", parent: jupiter,
        size: 2.4, color: "#e6cc60", accentColor: "#a07028", kind: "rocky",
        radius: 44, speed: 0.5, phase: 0.1, seed: 21 });
      this.addMoon({ id: "sol-europa", name: "Europa", parent: jupiter,
        size: 2.2, color: "#d8d0b8", accentColor: "#a89870", kind: "icy",
        radius: 56, speed: 0.4, phase: 1.7, seed: 22 });
      this.addMoon({ id: "sol-ganymede", name: "Ganymede", parent: jupiter,
        size: 3.0, color: "#9c8a78", accentColor: "#5a4a38", kind: "rocky",
        radius: 70, speed: 0.3, phase: 3.0, seed: 23 });
      this.addMoon({ id: "sol-callisto", name: "Callisto", parent: jupiter,
        size: 2.8, color: "#6c604c", accentColor: "#3a3020", kind: "barren",
        radius: 86, speed: 0.22, phase: 4.5, seed: 24 });
    }
    const saturn = findBody("sol-saturn");
    if (saturn) {
      this.addMoon({ id: "sol-titan", name: "Titan", parent: saturn,
        size: 2.6, color: "#d8a868", accentColor: "#7a5028", kind: "icy",
        radius: 90, speed: 0.25, phase: 1.0, tilt: 0.1, seed: 31 });
    }

    for (let i = 0; i < 8; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x88ffcc }),
      );
      orb.position.set((Math.random() - 0.5) * 1400, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 1400);
      this.scene.add(orb);
      this.orbs.push(orb);
    }
  }

  buildSystem(seed: number) {
    this.clearSystem();
    const rng = mulberry32(seed * 1000 + 7);
    const count = 6 + Math.floor(rng() * 5);

    const starOptions: Array<{ type: Discovery["type"]; color: string; size: number }> = [
      { type: "star", color: "#ffe6a0", size: 60 },
      { type: "star", color: "#ffd070", size: 70 },
      { type: "blue-giant", color: "#9ad0ff", size: 90 },
      { type: "red-dwarf", color: "#ff7060", size: 35 },
    ];
    const star = starOptions[Math.floor(rng() * starOptions.length)];
    this.addPlanetBody({
      id: `s${seed}-star`, name: generateName(seed * 1000),
      type: star.type, kind: "star",
      size: star.size, color: star.color,
      position: new THREE.Vector3(0, 0, 0), spin: 0.005,
    });

    const KINDS: PlanetKind[] = ["rocky", "gas", "icy", "ocean", "ringed", "lava", "barren"];
    const TYPE_FOR_KIND: Record<PlanetKind, Discovery["type"]> = {
      rocky: "planet", gas: "planet", icy: "planet", ocean: "planet",
      ringed: "ringed-planet", lava: "planet", barren: "planet",
    };
    const PALETTE: Record<PlanetKind, { base: string; accent: string; atmo: string }> = {
      rocky: { base: "#a86040", accent: "#5c2a18", atmo: "#ff9070" },
      gas: { base: "#c89878", accent: "#6a3a20", atmo: "#ffd9a8" },
      icy: { base: "#b0d0e8", accent: "#3870a0", atmo: "#a0d8ff" },
      ocean: { base: "#1f5fc0", accent: "#3a8a3c", atmo: "#7ab8ff" },
      ringed: { base: "#d8b478", accent: "#8a5a30", atmo: "#ffd89c" },
      lava: { base: "#cc4020", accent: "#3a0a05", atmo: "#ff8050" },
      barren: { base: "#888070", accent: "#403828", atmo: "#000000" },
    };

    for (let i = 1; i < count; i++) {
      const kind = KINDS[Math.floor(rng() * KINDS.length)];
      const dist = 220 + i * 160 + rng() * 140;
      const angle = rng() * Math.PI * 2;
      const elev = (rng() - 0.5) * 80;
      const size = kind === "gas" || kind === "ringed" ? 18 + rng() * 18 : 6 + rng() * 8;
      const cols = PALETTE[kind];
      this.addPlanetBody({
        id: `s${seed}-b${i}`, name: generateName(seed * 1000 + i),
        type: TYPE_FOR_KIND[kind], kind,
        size, color: cols.base, accentColor: cols.accent, atmoColor: cols.atmo,
        cloudiness: kind === "ocean" ? 0.5 : kind === "rocky" ? rng() * 0.4 : 0,
        position: new THREE.Vector3(Math.cos(angle) * dist, elev, Math.sin(angle) * dist),
        rings: kind === "ringed"
          ? { inner: size * 1.4, outer: size * (2.2 + rng() * 0.6), tilt: rng() * 0.9 - 0.1 }
          : undefined,
        seed: seed + i * 0.7,
      });

      // Maybe attach 1–2 moons. Bigger planets are more likely to have them.
      const parent = this.bodies[this.bodies.length - 1];
      const moonChance = kind === "gas" || kind === "ringed" ? 0.85 : size > 8 ? 0.45 : 0.15;
      const moonCount = rng() < moonChance ? 1 + Math.floor(rng() * 2) : 0;
      const moonKinds: Array<"barren" | "rocky" | "icy"> = ["barren", "rocky", "icy"];
      const moonPalette = ["#cfc8b8", "#9c8a78", "#d8d0c0", "#a89870", "#8a7a68"];
      for (let m = 0; m < moonCount; m++) {
        const mkind = moonKinds[Math.floor(rng() * moonKinds.length)];
        const mcolor = moonPalette[Math.floor(rng() * moonPalette.length)];
        this.addMoon({
          id: `s${seed}-b${i}-m${m}`,
          name: `${parent.name} ${String.fromCharCode(97 + m)}`,
          parent,
          size: Math.max(0.8, size * (0.12 + rng() * 0.18)),
          color: mcolor,
          kind: mkind,
          radius: size * (2.4 + m * 1.1) + rng() * 4,
          speed: 0.15 + rng() * 0.5,
          phase: rng() * Math.PI * 2,
          tilt: (rng() - 0.5) * 0.4,
          seed: seed + i * 7 + m * 3,
        });
      }
    }

    for (let i = 0; i < 8; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x88ffcc }),
      );
      orb.position.set((rng() - 0.5) * 1200, (rng() - 0.5) * 100, (rng() - 0.5) * 1200);
      this.scene.add(orb);
      this.orbs.push(orb);
    }
  }

  setMouse(x: number, y: number) {
    // x,y in -1..1
    const dz = 0.1;
    const apply = (v: number) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));
    this.mouseX = apply(x);
    this.mouseY = apply(y);
  }

  /**
   * Debug helper: snap the ship to face the nearest unscanned body so the
   * crosshair lands on a scannable target without manual mouse-look. Also
   * resets mouse-look input so the ship stops drifting after the snap.
   */
  aimAtNearestBody() {
    let nearest: { dist: number; pos: THREE.Vector3 } | null = null;
    for (const b of this.bodies) {
      if (b.scanned) continue;
      const d = b.mesh.position.distanceTo(this.ship.position);
      if (!nearest || d < nearest.dist) nearest = { dist: d, pos: b.mesh.position };
    }
    if (!nearest) return;
    // Build a rotation matrix that looks from the ship toward the target.
    // Three.js's lookAt orients the +Z axis toward the target, but our ship's
    // forward is -Z, so we flip by looking AWAY from the target instead.
    const m = new THREE.Matrix4();
    const flipped = this.ship.position.clone().multiplyScalar(2).sub(nearest.pos);
    m.lookAt(this.ship.position, flipped, new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(m);
    this.mouseX = 0;
    this.mouseY = 0;
  }

  /**
   * Returns ship-local positions of nearby bodies/orbs for the minimap.
   * Coordinates normalized to [-1, 1] within `range`. x = right, z = forward (negative = ahead).
   */
  getMinimapSnapshot(targetType: Discovery["type"] | "orb" | null, range = 800) {
    const inv = this.ship.matrixWorld.clone().invert();
    const tmp = new THREE.Vector3();

    type Dot = {
      x: number;
      z: number;
      kind: "planet" | "ringed-planet" | "moon" | "star" | "blue-giant" | "red-dwarf" | "orb";
      scanned: boolean;
      isTarget: boolean;
      ahead: boolean;
      distance: number;
    };

    const dots: Dot[] = [];
    let target: { dist: number; idx: number } | null = null;
    // Track nearest objective target across ALL distances (for off-radar arrow)
    let nearestTarget: { distance: number; dx: number; dz: number } | null = null;

    const considerNearestTarget = (distance: number, dx: number, dz: number) => {
      if (!nearestTarget || distance < nearestTarget.distance) {
        nearestTarget = { distance, dx, dz };
      }
    };

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      tmp.copy(b.mesh.position).applyMatrix4(inv);
      const distance = tmp.length();
      const isTargetCandidate =
        targetType !== null && targetType !== "orb" && b.type === targetType && !b.scanned;
      if (isTargetCandidate) considerNearestTarget(distance, tmp.x, tmp.z);
      if (distance > range) continue;
      const idx = dots.length;
      dots.push({
        x: tmp.x / range,
        z: tmp.z / range,
        kind: b.type,
        scanned: b.scanned,
        isTarget: false,
        ahead: tmp.z < 0,
        distance,
      });
      if (isTargetCandidate && (!target || distance < target.dist)) {
        target = { dist: distance, idx };
      }
    }

    if (targetType === "orb") {
      let bestOrb: { d: number; i: number } | null = null;
      for (const o of this.orbs) {
        tmp.copy(o.position).applyMatrix4(inv);
        const distance = tmp.length();
        considerNearestTarget(distance, tmp.x, tmp.z);
        if (distance > range) continue;
        const idx = dots.length;
        dots.push({
          x: tmp.x / range,
          z: tmp.z / range,
          kind: "orb",
          scanned: false,
          isTarget: false,
          ahead: tmp.z < 0,
          distance,
        });
        if (!bestOrb || distance < bestOrb.d) bestOrb = { d: distance, i: idx };
      }
      if (bestOrb) dots[bestOrb.i].isTarget = true;
    } else {
      for (const o of this.orbs) {
        tmp.copy(o.position).applyMatrix4(inv);
        const distance = tmp.length();
        if (distance > range) continue;
        dots.push({
          x: tmp.x / range,
          z: tmp.z / range,
          kind: "orb",
          scanned: false,
          isTarget: false,
          ahead: tmp.z < 0,
          distance,
        });
      }
    }

    if (target) dots[target.idx].isTarget = true;

    // If the nearest target is outside the radar range, expose it as an off-radar pointer
    let offRangeTarget: { x: number; z: number; distance: number } | null = null;
    if (nearestTarget !== null) {
      const nt = nearestTarget as { distance: number; dx: number; dz: number };
      if (nt.distance > range) {
        const len = Math.hypot(nt.dx, nt.dz) || 1;
        offRangeTarget = { x: nt.dx / len, z: nt.dz / len, distance: nt.distance };
      }
    }

    return { dots, range, offRangeTarget };
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  triggerWarp() {
    if (this.warpCharge < 1 || this.isWarping) return;
    this.isWarping = true;
    this.warpTimer = 2.5;
    this.warpCharge = 0;
    (this.warpStars.material as THREE.PointsMaterial).opacity = 1;
    this.warpStars.visible = true;
    // Cinematic bloom flash — spike then ease back via update loop.
    this.bloomBoost = 2.4;
  }

  update(dt: number) {
    if (this.paused) {
      this.composer.render();
      return;
    }

    // Steering from mouse
    const yawRate = -this.mouseX * 0.8;
    const pitchRate = -this.mouseY * 0.8;
    this.ship.rotateY(yawRate * dt);
    this.ship.rotateX(pitchRate * dt);

    // Roll from A/D / arrows
    let rollInput = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rollInput += 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rollInput -= 1;
    this.ship.rotateZ(rollInput * 1.2 * dt);

    // Thrust
    let thrustInput = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) thrustInput += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) thrustInput -= 0.6;
    this.boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2.5 : 1;
    this.thrust = thrustInput;

    const targetVel = thrustInput * 60 * this.boost;
    this.velocity += (targetVel - this.velocity) * Math.min(1, dt * 1.2);
    if (Math.abs(this.velocity) < 0.05) this.velocity = 0;

    // Move ship along its forward (-Z)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    this.ship.position.addScaledVector(forward, this.velocity * dt);

    // Warp charging
    if (!this.isWarping && this.warpCharge < 1) {
      this.warpCharge = Math.min(1, this.warpCharge + dt * 0.08);
    }
    if (this.isWarping) {
      this.warpTimer -= dt;
      // Speed boost during warp
      this.ship.position.addScaledVector(forward, 800 * dt);
      // Pull warp stars in
      const positions = this.warpStars.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i++) {
        let z = positions.getZ(i);
        z += dt * 600;
        if (z > 0) {
          z = -800;
          positions.setX(i, (Math.random() - 0.5) * 200);
          positions.setY(i, (Math.random() - 0.5) * 200);
        }
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;

      if (this.warpTimer <= 0) {
        this.isWarping = false;
        (this.warpStars.material as THREE.PointsMaterial).opacity = 0;
        this.warpStars.visible = false;
        this.systemSeed += 1;
        this.buildSystem(this.systemSeed);
      }
    }

    // Discoveries: lock-on scan. Hold the body within the aim cone for 4s.
    const SCAN_HOLD = 4; // seconds
    const AIM_COS = Math.cos((6 * Math.PI) / 180); // ~6° cone half-angle
    const MAX_LOCK_RANGE = 2000;
    const aimForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    const toBody = new THREE.Vector3();
    let scanning: { body: Body; progress: number } | null = null;
    for (const b of this.bodies) {
      if (b.scanned) continue;
      toBody.copy(b.mesh.position).sub(this.ship.position);
      const dist = toBody.length();
      if (dist > MAX_LOCK_RANGE) {
        b.aimTime = 0;
        continue;
      }
      toBody.divideScalar(dist || 1);
      // Effective cone widens slightly for larger bodies (angular radius).
      const angularRadius = Math.min(0.2, b.size / Math.max(dist, 1));
      const aligned = aimForward.dot(toBody) >= AIM_COS - angularRadius;
      if (aligned) {
        b.aimTime = (b.aimTime ?? 0) + dt;
        const progress = Math.min(1, b.aimTime / SCAN_HOLD);
        if (!scanning || progress > scanning.progress) {
          scanning = { body: b, progress };
        }
      } else {
        // Decay so brief glances don't accumulate forever.
        b.aimTime = Math.max(0, (b.aimTime ?? 0) - dt * 2);
      }
    }
    if (scanning) {
      const b = scanning.body;
      this.callbacks.onScanProgress({ name: b.name, progress: scanning.progress });
      if (scanning.progress >= 1) {
        b.scanned = true;
        const discovery: Discovery = {
          id: b.id,
          name: b.name,
          type: b.type,
          size: b.size,
          color: b.color,
          distance: this.ship.position.length(),
          discoveredAt: Date.now(),
        };
        saveDiscovery(discovery);
        this.callbacks.onDiscovery(discovery);
        this.callbacks.onScanProgress(null);
      }
    } else {
      this.callbacks.onScanProgress(null);
    }

    // Energy orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.rotation.y += dt * 2;
      o.scale.setScalar(1 + Math.sin(performance.now() * 0.005 + i) * 0.2);
      if (o.position.distanceTo(this.ship.position) < 8) {
        this.scene.remove(o);
        (o.material as THREE.Material).dispose?.();
        o.geometry.dispose();
        this.orbs.splice(i, 1);
        this.callbacks.onOrbCollected();
      }
    }

    // Keep starfield centered around ship for parallax illusion
    this.starField.position.copy(this.ship.position);

    // Cockpit dust streaks: drift toward the camera based on current velocity.
    // Particles live in camera-local space, so we just push +Z (toward viewer)
    // and recycle when they pass behind. Opacity/size scale with speed so the
    // effect is invisible at rest and pronounced at boost.
    {
      const speed = Math.abs(this.velocity);
      // Only start fading dust in once we're actually moving briskly. Below ~30 u/s
      // it stays invisible so we don't get the "fog in the cockpit" look at rest.
      const speedNorm = Math.max(0, Math.min(1, (speed - 30) / 170));
      const dustMat = this.dustField.material as THREE.PointsMaterial;
      // Hide entirely during warp (warp field takes over) and when not moving fast.
      const targetOpacity = this.isWarping ? 0 : 0.18 * speedNorm;
      dustMat.opacity += (targetOpacity - dustMat.opacity) * Math.min(1, dt * 6);
      dustMat.size = 0.5 + speedNorm * 0.7;

      if (dustMat.opacity > 0.01) {
        const positions = this.dustField.geometry.attributes.position as THREE.BufferAttribute;
        const drift = 30 + speed * 1.4; // units/sec backward in camera space
        const HALF_X = 120;
        const HALF_Y = 80;
        const Z_NEAR = -260;
        const Z_FAR = 40;
        for (let i = 0; i < positions.count; i++) {
          let z = positions.getZ(i) + drift * dt;
          if (z > Z_FAR) {
            z = Z_NEAR;
            positions.setX(i, (Math.random() - 0.5) * HALF_X * 2);
            positions.setY(i, (Math.random() - 0.5) * HALF_Y * 2);
          }
          positions.setZ(i, z);
        }
        positions.needsUpdate = true;
      }
    }

    // Planet spin + shader uniform tick + lens flare alignment.
    // Sun source for shading: the first star body in the scene (Sol or generated star).
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    const tmp = new THREE.Vector3();
    const sunBody = this.bodies.find((b) => b.isStar);
    const sunPos = sunBody ? sunBody.mesh.position : new THREE.Vector3(0, 0, 0);
    const sunDirTmp = new THREE.Vector3();
    const nowSec = performance.now() * 0.001;
    for (const b of this.bodies) {
      // Orbital motion for moons (and any other body with orbit data).
      if (b.orbit) {
        b.orbit.phase += b.orbit.speed * dt;
        const r = b.orbit.radius;
        const c = Math.cos(b.orbit.phase);
        const s = Math.sin(b.orbit.phase);
        const t = b.orbit.tilt;
        b.mesh.position.set(
          b.orbit.parent.position.x + c * r,
          b.orbit.parent.position.y + s * r * Math.sin(t),
          b.orbit.parent.position.z + s * r * Math.cos(t),
        );
      }
      const spin = (b.mesh as THREE.Mesh & { _spin?: number })._spin;
      if (spin) b.mesh.rotation.y += spin * dt;
      // Drive shader uniforms (time + sun direction in world space, pointing FROM planet TO sun)
      if (b.shaderMat) {
        sunDirTmp.copy(sunPos).sub(b.mesh.position);
        if (sunDirTmp.lengthSq() < 1e-6) sunDirTmp.set(1, 0.3, 0.5);
        sunDirTmp.normalize();
        tickPlanetUniforms(b.shaderMat, nowSec, sunDirTmp);
      }
      if (b.flare && b.isStar) {
        tmp.copy(b.mesh.position).sub(this.ship.position);
        const distToStar = tmp.length();
        tmp.divideScalar(distToStar || 1);
        const align = Math.max(0, tmp.dot(camForward)); // 0..1
        // Fade the lens flare out when very close to the star so it can't fill
        // the screen with white when staring directly at the sun (this was the
        // "blank screen" symptom right after a scan completed near a star).
        const proximityFade = Math.min(1, Math.max(0, (distToStar - b.size * 4) / (b.size * 8)));
        const intensity = Math.pow(align, 6) * proximityFade;
        const mat = b.flare.material as THREE.SpriteMaterial;
        mat.opacity = intensity * 0.7;
        const baseScale = b.size * 10;
        const s = baseScale * (0.6 + intensity * 0.6);
        b.flare.scale.set(s, s, 1);
      }
    }

    // Ease bloom boost back to zero (slower decay for a lingering afterglow).
    if (this.bloomBoost > 0.001) {
      this.bloomBoost = Math.max(0, this.bloomBoost - dt * 1.4);
    } else {
      this.bloomBoost = 0;
    }
    this.bloomPass.strength = this.bloomBase + this.bloomBoost;

    this.composer.render();
  }

  dispose() {
    this.clearSystem();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
