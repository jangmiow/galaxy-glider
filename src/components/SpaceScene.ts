import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { generateName, saveDiscovery, type Discovery } from "@/lib/journal";

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
};

export type SceneCallbacks = {
  onDiscovery: (d: Discovery) => void;
  onScanProgress: (info: { name: string; progress: number } | null) => void;
  onOrbCollected: () => void;
};

const TYPE_COLORS: Record<Discovery["type"], string[]> = {
  planet: ["#6aa8ff", "#a86aff", "#ffaa6a", "#88dd88", "#dd6688"],
  "ringed-planet": ["#e8c97a", "#c9a86a", "#9aa8e8"],
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

// 2D value-noise with octaves on a canvas, returning a CanvasTexture.
function makePlanetTexture(
  type: Discovery["type"],
  baseColor: string,
  rng: () => number,
): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);

  const base = new THREE.Color(baseColor);
  // Pick contrasting accent depending on type
  const accent = new THREE.Color(baseColor).offsetHSL(
    type === "ringed-planet" ? 0.05 : (rng() - 0.5) * 0.3,
    0,
    type === "red-dwarf" ? -0.2 : -0.25,
  );
  const highlight = new THREE.Color(baseColor).offsetHSL(0, -0.1, 0.25);

  // Hash-based value noise
  const seed = Math.floor(rng() * 100000);
  const hash = (x: number, y: number) => {
    let h = x * 374761393 + y * 668265263 + seed * 1442695040;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const valueNoise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const v00 = hash(xi, yi);
    const v10 = hash(xi + 1, yi);
    const v01 = hash(xi, yi + 1);
    const v11 = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  };
  const fbm = (x: number, y: number, oct: number) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  // Style varies by type
  const isGasGiant = type === "ringed-planet" || rng() < 0.35;
  const scale = isGasGiant ? 3 : 5 + rng() * 4;
  const bandStrength = isGasGiant ? 0.7 + rng() * 0.3 : 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      // Spherical-ish coords
      const nx = u * scale * 2;
      const ny = v * scale;
      let n = fbm(nx, ny, 5);
      if (isGasGiant) {
        // Horizontal bands with turbulence
        const band = Math.sin(v * Math.PI * (4 + rng() * 4) + n * 4) * 0.5 + 0.5;
        n = n * (1 - bandStrength) + band * bandStrength;
      }
      // Pole darkening
      const pole = 1 - Math.pow(Math.abs(v - 0.5) * 2, 2) * 0.4;
      n *= pole;

      const t = Math.max(0, Math.min(1, n));
      let r: number, g: number, b: number;
      if (t < 0.4) {
        const k = t / 0.4;
        r = lerp(accent.r, base.r, k);
        g = lerp(accent.g, base.g, k);
        b = lerp(accent.b, base.b, k);
      } else {
        const k = (t - 0.4) / 0.6;
        r = lerp(base.r, highlight.r, k);
        g = lerp(base.g, highlight.g, k);
        b = lerp(base.b, highlight.b, k);
      }
      const idx = (y * W + x) * 4;
      img.data[idx] = (r * 255) | 0;
      img.data[idx + 1] = (g * 255) | 0;
      img.data[idx + 2] = (b * 255) | 0;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Soft radial sprite texture (used for atmosphere glow + lens flare core).
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
    this.buildNebulae();
    this.buildSystem(1);

    // Lights
    const ambient = new THREE.AmbientLight(0x222244, 0.6);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffeebb, 1.0);
    sun.position.set(100, 50, 100);
    this.scene.add(sun);
  }

  buildStarfield() {
    const count = 6000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Distribute on a large sphere shell
      const r = 800 + Math.random() * 1500;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const t = Math.random();
      // Mix of white/blue/amber
      if (t < 0.7) { col[i*3] = 1; col[i*3+1] = 1; col[i*3+2] = 1; }
      else if (t < 0.9) { col[i*3] = 0.6; col[i*3+1] = 0.8; col[i*3+2] = 1; }
      else { col[i*3] = 1; col[i*3+1] = 0.8; col[i*3+2] = 0.5; }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, transparent: true });
    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);
  }

  buildWarpField() {
    const count = 1500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random() - 0.5) * 200;
      pos[i*3+1] = (Math.random() - 0.5) * 200;
      pos[i*3+2] = -Math.random() * 800;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaaddff, size: 2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.warpStars = new THREE.Points(geo, mat);
    this.warpStars.visible = false;
    this.camera.add(this.warpStars);
  }

  buildNebulae() {
    const colors = [0x4466aa, 0xaa4466, 0x6644aa, 0xaa8844];
    for (let i = 0; i < 8; i++) {
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

  buildSystem(seed: number) {
    this.clearSystem();
    const rng = mulberry32(seed * 1000 + 7);
    const count = 6 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i++) {
      const type = randType(rng);
      const colors = TYPE_COLORS[type];
      const color = colors[Math.floor(rng() * colors.length)];
      const isStar = type === "star" || type === "blue-giant" || type === "red-dwarf";
      const size = isStar ? 30 + rng() * 60 : 8 + rng() * 22;
      const dist = 150 + i * 90 + rng() * 80;
      const angle = rng() * Math.PI * 2;
      const elev = (rng() - 0.5) * 60;

      const geo = new THREE.SphereGeometry(size, 48, 32);
      let mat: THREE.Material;
      if (isStar) {
        mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
      } else {
        const tex = makePlanetTexture(type, color, rng);
        mat = new THREE.MeshStandardMaterial({
          map: tex,
          color: 0xffffff,
          roughness: 0.92,
          metalness: 0.02,
        });
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(angle) * dist, elev, Math.sin(angle) * dist);
      // Slow axial spin for life
      mesh.rotation.y = rng() * Math.PI * 2;
      (mesh as THREE.Mesh & { _spin?: number })._spin = (rng() - 0.5) * 0.05;

      let flareSprite: THREE.Sprite | undefined;

      if (isStar) {
        // Soft corona
        const coronaTex = makeRadialTexture(color, 0.9);
        const corona = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: coronaTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
        );
        corona.scale.set(size * 6, size * 6, 1);
        mesh.add(corona);

        // Lens flare (cross/streak), scaled per-frame based on view alignment
        const flareTex = makeFlareStreakTexture(color);
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
        flareSprite.scale.set(size * 14, size * 14, 1);
        flareSprite.renderOrder = 999;
        mesh.add(flareSprite);

        const light = new THREE.PointLight(new THREE.Color(color), 1.2, 600);
        mesh.add(light);
      } else {
        // Atmospheric rim glow (slightly larger billboard behind the planet, additive)
        const atmoColor = new THREE.Color(color).offsetHSL(0.02, 0.1, 0.15).getStyle();
        const atmoTex = makeRadialTexture(atmoColor, 0.55, 1);
        const atmo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: atmoTex,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.85,
            fog: false,
          }),
        );
        atmo.scale.set(size * 2.6, size * 2.6, 1);
        mesh.add(atmo);
      }

      if (type === "ringed-planet") {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.4, size * 2.2, 96),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
        );
        ring.rotation.x = Math.PI / 2 - 0.3;
        mesh.add(ring);
      }

      this.scene.add(mesh);
      const id = `s${seed}-b${i}`;
      this.bodies.push({
        mesh, type, size, color, id,
        name: generateName(seed * 1000 + i),
        scanned: false,
        flare: flareSprite,
        isStar,
      });
    }

    // Energy orbs
    for (let i = 0; i < 8; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x88ffcc })
      );
      orb.position.set((rng() - 0.5) * 600, (rng() - 0.5) * 100, (rng() - 0.5) * 600);
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
   * Returns ship-local positions of nearby bodies/orbs for the minimap.
   * Coordinates normalized to [-1, 1] within `range`. x = right, z = forward (negative = ahead).
   */
  getMinimapSnapshot(targetType: Discovery["type"] | "orb" | null, range = 800) {
    const inv = this.ship.matrixWorld.clone().invert();
    const tmp = new THREE.Vector3();

    type Dot = {
      x: number;
      z: number;
      kind: "planet" | "ringed-planet" | "star" | "blue-giant" | "red-dwarf" | "orb";
      scanned: boolean;
      isTarget: boolean;
      ahead: boolean;
      distance: number;
    };

    const dots: Dot[] = [];
    let target: { dist: number; idx: number } | null = null;

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      tmp.copy(b.mesh.position).applyMatrix4(inv);
      const distance = tmp.length();
      if (distance > range) continue;
      const isTargetCandidate =
        targetType !== null && targetType !== "orb" && b.type === targetType && !b.scanned;
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

    return { dots, range };
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

    // Discoveries: scan nearby bodies
    let scanning: { body: Body; dist: number } | null = null;
    for (const b of this.bodies) {
      if (b.scanned) continue;
      const d = b.mesh.position.distanceTo(this.ship.position);
      const scanRange = b.size * 6 + 40;
      if (d < scanRange) {
        if (!scanning || d < scanning.dist) scanning = { body: b, dist: d };
      }
    }
    if (scanning) {
      const b = scanning.body;
      const range = b.size * 6 + 40;
      const progress = Math.max(0, Math.min(1, 1 - scanning.dist / range));
      this.callbacks.onScanProgress({ name: b.name, progress });
      if (progress > 0.85) {
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

    // Planet spin + lens flare alignment
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    const tmp = new THREE.Vector3();
    for (const b of this.bodies) {
      const spin = (b.mesh as THREE.Mesh & { _spin?: number })._spin;
      if (spin) b.mesh.rotation.y += spin * dt;
      if (b.flare && b.isStar) {
        tmp.copy(b.mesh.position).sub(this.ship.position).normalize();
        const align = Math.max(0, tmp.dot(camForward)); // 0..1
        const intensity = Math.pow(align, 6);
        const mat = b.flare.material as THREE.SpriteMaterial;
        mat.opacity = intensity * 0.9;
        const baseScale = b.size * 14;
        const s = baseScale * (0.6 + intensity * 0.8);
        b.flare.scale.set(s, s, 1);
      }
    }

    this.composer.render();
  }

  dispose() {
    this.clearSystem();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
