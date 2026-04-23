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
  makeSunMaterial,
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

export type SystemCompletion = {
  systemId: string;
  systemName: string;
  bodyCount: number;
};

export type SceneCallbacks = {
  onDiscovery: (d: Discovery) => void;
  onScanProgress: (info: { name: string; progress: number; alreadyScanned?: boolean } | null) => void;
  onOrbCollected: () => void;
  onSystemComplete: (info: SystemCompletion) => void;
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
  /** Continuous thrust input (-1..1) from the mobile slider; combined with key input each frame. */
  virtualThrust = 0;
  pitch = 0;
  yaw = 0;
  roll = 0;
  warpCharge = 0;
  isWarping = false;
  warpTimer = 0;
  boost = 1;
  /** Active timed-burst (Space-tap) state — multiplies thrust for ~2s. */
  boostActive = false;
  boostTimer = 0;
  /** Cooldown timer (s); cannot re-burst until this reaches 0. */
  boostCooldown = 0;
  readonly BOOST_DURATION = 2;
  readonly BOOST_COOLDOWN = 1;
  readonly BOOST_MULT = 3;
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

  /** Active proximity to the nearest non-star body (drives HUD vignette). */
  proximity: { closeness: number; color: string } | null = null;
  /** Active F-key "frame target" rotation tween, if any. */
  frameTween: { from: THREE.Quaternion; to: THREE.Quaternion; elapsed: number; duration: number; targetId: string; targetName: string } | null = null;
  /** Approach autopilot state: follows a Catmull-Rom spline toward the chosen body. */
  approach: {
    active: boolean;
    targetId: string | null;
    targetName: string | null;
    distance: number;
    /** Smooth path from ship → hold point. Recomputed at engage; refreshed if the ship drifts off. */
    path: THREE.CatmullRomCurve3 | null;
    /** Cached arc length so we can move at a controlled speed regardless of curve shape. */
    pathLength: number;
    /** 0..1 progress along the spline (used to look ahead for steering, not to set position). */
    pathU: number;
    /** Slew-rate-limited thrust (-1..1) so the lever never snaps. */
    smoothedThrust: number;
    /** Engage timestamp so we can ease thrust in over the first ~1s. */
    engagedAt: number;
  } = {
    active: false, targetId: null, targetName: null, distance: 0,
    path: null, pathLength: 0, pathU: 0, smoothedThrust: 0, engagedAt: 0,
  };
  /**
   * Cinematic flyby autopilot — orbits the target body for ~1.25 laps so the
   * pilot can study it from every angle (terminator pass, back-lit crescent,
   * ring shadow). The orbit lives on a plane defined by `center` + `normal`,
   * radius is periapsis altitude, and the ship sweeps `sweep` radians.
   */
  flyby: {
    active: boolean;
    targetId: string | null;
    targetName: string | null;
    elapsed: number;
    duration: number;
    /** World-space orbit center (target body position at engage). */
    center: THREE.Vector3;
    /** Plane normal — defines orbit orientation. */
    normal: THREE.Vector3;
    /** First in-plane basis vector (cos axis). */
    basisX: THREE.Vector3;
    /** Second in-plane basis vector (sin axis). */
    basisY: THREE.Vector3;
    /** Periapsis altitude (distance from center). */
    radius: number;
    startAngle: number;
    /** Total radians to sweep — 2.5π ≈ 1.25 laps for the cinematic full orbit. */
    sweep: number;
    /** Manual nudge — widens / tightens the radius via cursor + WASD. */
    nudgeRadius: number;
    /** Manual nudge — tilts the orbital plane via cursor + WASD. */
    nudgeTilt: number;
    /** Compatibility aliases mapped onto the new model so the HUD bars keep working. */
    nudgeLateral: number;
    nudgeVertical: number;
  } = {
    active: false, targetId: null, targetName: null,
    elapsed: 0, duration: 0,
    center: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    basisX: new THREE.Vector3(1, 0, 0),
    basisY: new THREE.Vector3(0, 0, 1),
    radius: 0,
    startAngle: 0,
    sweep: Math.PI * 2.5,
    nudgeRadius: 0,
    nudgeTilt: 0,
    nudgeLateral: 0,
    nudgeVertical: 0,
  };
  /**
   * Configurable flyby parameters. Applied at engage time only — changes
   * mid-flyby do not reshape the active curve. Defaults match the original
   * cinematic feel (3× radius, no offset, ~8s + size scaling).
   */
  flybyConfig = {
    /** Periapsis altitude as a multiple of target radius (1.5–8). */
    altitudeMul: 3,
    /** Lateral offset of the closest-approach point along ship-up, in target radii (-3..3). */
    offsetMul: 0,
    /** Duration multiplier applied to the size-scaled base duration (0.5–2.5). */
    durationMul: 1,
  };
  /** Min/max for UI sliders + hotkey clamps. Single source of truth. */
  static readonly FLYBY_LIMITS = {
    altitudeMul: { min: 1.5, max: 8, step: 0.25 },
    offsetMul: { min: -3, max: 3, step: 0.25 },
    durationMul: { min: 0.5, max: 2.5, step: 0.1 },
  };
  /**
   * Configurable autopilot override thresholds. The pilot must either hold a
   * thrust/strafe/roll key continuously for `holdMs`, OR accumulate enough
   * tap-input within a sliding 1.5s window (each frame the key is down adds
   * `dt` seconds to the accumulator; it decays at `1/decaySec` per second
   * when released) to exceed `accumSec`. Whichever crosses first triggers
   * abort. Higher numbers = harder to accidentally cancel.
   */
  overrideConfig = {
    /** Continuous-hold duration before override fires, in milliseconds. */
    holdMs: 250,
    /** Accumulated active-input seconds before override fires (sliding window). */
    accumSec: 0.6,
  };
  static readonly OVERRIDE_LIMITS = {
    holdMs: { min: 0, max: 2000, step: 50 },
    accumSec: { min: 0.1, max: 3, step: 0.1 },
  };
  /** Per-autopilot input trackers used to evaluate overrideConfig each frame. */
  private overrideState = {
    flyby: { heldMs: 0, accum: 0 },
    approach: { heldMs: 0, accum: 0 },
  };
  /** Scan-range ring visualization (lives on the XZ plane around the ship). */
  readonly SCAN_RING_RADIUS = 2000;
  scanRingGroup!: THREE.Group;
  scanRingOuter!: THREE.Mesh;
  scanRingInner!: THREE.Mesh;
  /** Drives the rotating sweep + pulse on the scan ring. */
  private scanRingTime = 0;
  /** Dashed ghost line that previews the flyby curve while autopilot is active. */
  flybyPreviewLine!: THREE.Line;
  /** Cinematic banking model — angular velocity (rad/s) on the ship's roll axis. */
  rollVel = 0;
  /** Max sustained roll rate (rad/s). Tweak for snappier or floatier banks. */
  ROLL_MAX_RATE = 1.6;
  /** How fast roll velocity accelerates toward the input target (1/s). Higher = snappier. */
  ROLL_ACCEL = 3.0;
  /** How fast roll velocity decays back to zero with no input (1/s). Lower = floatier. */
  ROLL_DAMPING = 1.4;
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
      0.15, // threshold — slightly lower so atmospheres + ring-lit edges bloom too
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.ship = new THREE.Object3D();
    this.ship.add(this.camera);
    this.scene.add(this.ship);

    // Scan-range ring: a translucent disc-edge centered on the ship that
    // visualizes the 2000u lock-on range. Color/opacity react to the nearest
    // body's proximity each frame so the pilot can see when something enters
    // catalogue range. Two concentric rings give a faint "sweep" feel.
    this.scanRingGroup = new THREE.Group();
    const makeRing = (radius: number, thickness: number, opacity: number) => {
      const g = new THREE.RingGeometry(radius - thickness, radius, 96, 1);
      const m = new THREE.MeshBasicMaterial({
        color: 0x66ddff,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2; // lay flat on XZ plane
      return mesh;
    };
    this.scanRingOuter = makeRing(this.SCAN_RING_RADIUS, 8, 0.18);
    this.scanRingInner = makeRing(this.SCAN_RING_RADIUS * 0.6, 4, 0.10);
    this.scanRingGroup.add(this.scanRingOuter);
    this.scanRingGroup.add(this.scanRingInner);
    this.ship.add(this.scanRingGroup);

    // Ghost preview line for the upcoming flyby curve. Hidden until a flyby
    // is active; when active, we resample the Bezier (with current nudges
    // applied) every frame so the dashed trail visibly shifts as the pilot
    // sweeps the cursor or taps WASD/arrows. 64 segments is enough for a
    // smooth arc at typical fly-by ranges; geometry is updated in place.
    {
      const segs = 64;
      const positions = new Float32Array((segs + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineDashedMaterial({
        color: 0x66ddff,
        transparent: true,
        opacity: 0.7,
        dashSize: 12,
        gapSize: 8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      this.flybyPreviewLine = new THREE.Line(geo, mat);
      this.flybyPreviewLine.frustumCulled = false;
      this.flybyPreviewLine.visible = false;
      this.scene.add(this.flybyPreviewLine);
    }

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
    const geo = new THREE.SphereGeometry(config.size, isStar ? 48 : 96, isStar ? 32 : 72);

    let mat: THREE.Material;
    let shaderMat: THREE.ShaderMaterial | undefined;
    if (isStar) {
      shaderMat = makeSunMaterial({ color: config.color, accent: config.accentColor, seed });
      mat = shaderMat;
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
            atmoStrength: 1.85,
          });
      }
      // Beef up the limb glow on terrestrial bodies after construction so
      // close-approach silhouettes feel atmospheric (PHM-style awe).
      if (shaderMat) {
        const u = (shaderMat as THREE.ShaderMaterial).uniforms?.uAtmoStrength;
        if (u) {
          if (config.kind === "ocean") u.value = 2.1;
          else if (config.kind === "icy") u.value = 1.6;
        }
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
    const geo = new THREE.SphereGeometry(config.size, 64, 48);

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
        size: 9, color: "#9a8b7a", accentColor: "#5c4f44",
        position: new THREE.Vector3(270, 0, 0), seed: 1.1 },
      { id: "sol-venus", name: "Venus", type: "planet", kind: "lava",
        size: 16, color: "#d9a460", accentColor: "#7c5828", atmoColor: "#ffd089",
        position: new THREE.Vector3(0, 6, 360), seed: 2.2 },
      { id: "sol-earth", name: "Earth", type: "planet", kind: "ocean",
        size: 18, color: "#1c5cb8", accentColor: "#3a8a3c", atmoColor: "#7ab8ff",
        cloudiness: 0.6,
        position: new THREE.Vector3(-465, -3, 120), seed: 3.3 },
      { id: "sol-mars", name: "Mars", type: "planet", kind: "rocky",
        size: 13, color: "#c1543a", accentColor: "#7a3322", atmoColor: "#ff9070",
        cloudiness: 0.25,
        position: new THREE.Vector3(180, 12, -510), seed: 4.4 },
      { id: "sol-jupiter", name: "Jupiter", type: "planet", kind: "gas",
        size: 58, color: "#caa074", accentColor: "#7d4f30", atmoColor: "#ffd9a8",
        position: new THREE.Vector3(-720, 0, -570), seed: 5.5 },
      { id: "sol-saturn", name: "Saturn", type: "ringed-planet", kind: "ringed",
        size: 50, color: "#e0c084", accentColor: "#9a7438", atmoColor: "#ffe6b0",
        position: new THREE.Vector3(930, -15, 330),
        rings: { inner: 80, outer: 150, tilt: 0.45, color: "#d8c89c" }, seed: 6.6 },
      { id: "sol-uranus", name: "Uranus", type: "planet", kind: "icy",
        size: 30, color: "#a8e0e0", accentColor: "#5cb0c0", atmoColor: "#cdf0ff",
        position: new THREE.Vector3(-1080, 45, 810), seed: 7.7 },
      { id: "sol-neptune", name: "Neptune", type: "planet", kind: "icy",
        size: 28, color: "#3859d8", accentColor: "#1d2c80", atmoColor: "#7090ff",
        position: new THREE.Vector3(1230, -60, -1020), seed: 8.8 },
    ];
    for (const p of planets) this.addPlanetBody(p);

    // Attach hand-picked moons to a few notable planets so the journal can log them.
    const findBody = (id: string) => this.bodies.find((b) => b.id === id);
    const earth = findBody("sol-earth");
    if (earth) {
      this.addMoon({ id: "sol-luna", name: "Luna", parent: earth,
        size: 3.2, color: "#cfc8b8", accentColor: "#807a6c", kind: "barren",
        radius: 24, speed: 0.35, seed: 11 });
    }
    const mars = findBody("sol-mars");
    if (mars) {
      this.addMoon({ id: "sol-phobos", name: "Phobos", parent: mars,
        size: 1.6, color: "#8a7a68", kind: "barren",
        radius: 16, speed: 0.7, phase: 0.2, seed: 12 });
      this.addMoon({ id: "sol-deimos", name: "Deimos", parent: mars,
        size: 1.3, color: "#9a8a78", kind: "barren",
        radius: 22, speed: 0.45, phase: 2.4, seed: 13 });
    }
    const jupiter = findBody("sol-jupiter");
    if (jupiter) {
      this.addMoon({ id: "sol-io", name: "Io", parent: jupiter,
        size: 3.4, color: "#e6cc60", accentColor: "#a07028", kind: "rocky",
        radius: 58, speed: 0.5, phase: 0.1, seed: 21 });
      this.addMoon({ id: "sol-europa", name: "Europa", parent: jupiter,
        size: 3.2, color: "#d8d0b8", accentColor: "#a89870", kind: "icy",
        radius: 74, speed: 0.4, phase: 1.7, seed: 22 });
      this.addMoon({ id: "sol-ganymede", name: "Ganymede", parent: jupiter,
        size: 4.4, color: "#9c8a78", accentColor: "#5a4a38", kind: "rocky",
        radius: 92, speed: 0.3, phase: 3.0, seed: 23 });
      this.addMoon({ id: "sol-callisto", name: "Callisto", parent: jupiter,
        size: 4.0, color: "#6c604c", accentColor: "#3a3020", kind: "barren",
        radius: 112, speed: 0.22, phase: 4.5, seed: 24 });
    }
    const saturn = findBody("sol-saturn");
    if (saturn) {
      this.addMoon({ id: "sol-titan", name: "Titan", parent: saturn,
        size: 3.8, color: "#d8a868", accentColor: "#7a5028", kind: "icy",
        radius: 118, speed: 0.25, phase: 1.0, tilt: 0.1, seed: 31 });
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
      const dist = 420 + i * 310 + rng() * 220;
      const angle = rng() * Math.PI * 2;
      const elev = (rng() - 0.5) * 120;
      const size = kind === "gas" || kind === "ringed" ? 38 + rng() * 32 : 15 + rng() * 14;
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
          radius: size * (2.8 + m * 1.2) + rng() * 4,
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
   * Raycast from the camera through normalized device coords (-1..1) and
   * return the first body hit. Falls back to the nearest body within a small
   * angular tolerance of the click so tiny dots are still selectable. Stars
   * are excluded so a stray click on Sol can't engage autopilot toward it.
   */
  pickBodyAt(ndcX: number, ndcY: number): { id: string; name: string; dist: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    // Direct mesh hit first.
    const meshes = this.bodies.filter((b) => !b.isStar).map((b) => b.mesh);
    const hits = ray.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0].object as THREE.Mesh;
      const body = this.bodies.find((b) => b.mesh === hit);
      if (body) {
        return { id: body.id, name: body.name, dist: body.mesh.position.distanceTo(this.ship.position) };
      }
    }
    // Angular tolerance fallback — pick the body whose screen-space angle to
    // the click ray is smallest, within ~3° and inside 4000u.
    const TOL = Math.cos((3 * Math.PI) / 180);
    const MAX = 4000;
    let best: { dot: number; id: string; name: string; dist: number } | null = null;
    for (const b of this.bodies) {
      if (b.isStar) continue;
      const to = b.mesh.position.clone().sub(ray.ray.origin);
      const dist = to.length();
      if (dist > MAX) continue;
      to.normalize();
      const dot = to.dot(ray.ray.direction);
      if (dot < TOL) continue;
      if (!best || dot > best.dot) best = { dot, id: b.id, name: b.name, dist };
    }
    return best ? { id: best.id, name: best.name, dist: best.dist } : null;
  }

  /**
   * Debug helper: snap the ship to face the nearest unscanned body so the
   * crosshair lands on a scannable target without manual mouse-look. Also
   * resets mouse-look input so the ship stops drifting after the snap.
   */
  aimAtNearestBody() {
    // Pick the nearest unscanned, non-star body that is far enough away to
    // actually aim at (we might be spawned right next to / inside one) and
    // within scan range. Stars are excluded — aiming at Sol washes the screen.
    const MAX = 2000;
    const MIN = 50; // closer than this and we're effectively inside the body
    let best: { dist: number; pos: THREE.Vector3; name: string } | null = null;
    for (const b of this.bodies) {
      if (b.scanned || b.isStar) continue;
      const d = b.mesh.position.distanceTo(this.ship.position);
      if (d > MAX || d < MIN + b.size) continue;
      if (!best || d < best.dist) {
        best = { dist: d, pos: b.mesh.position.clone(), name: b.name };
      }
    }
    if (!best) {
      // eslint-disable-next-line no-console
      console.warn("[auto-aim] no scannable body within range");
      return null;
    }
    // eslint-disable-next-line no-console
    console.log(`[auto-aim] snapping to ${best.name} at ${best.dist.toFixed(0)}u`);
    // Build a rotation matrix that looks from the ship toward the target.
    // Three.js's lookAt orients the +Z axis toward the target, but our ship's
    // forward is -Z, so we flip by looking AWAY from the target instead.
    const m = new THREE.Matrix4();
    const flipped = this.ship.position.clone().multiplyScalar(2).sub(best.pos);
    m.lookAt(this.ship.position, flipped, new THREE.Vector3(0, 1, 0));
    this.ship.quaternion.setFromRotationMatrix(m);
    this.mouseX = 0;
    this.mouseY = 0;
    return { name: best.name, dist: best.dist };
  }

  /**
   * Cinematic counterpart to `aimAtNearestBody`: tweens the ship's quaternion
   * toward the nearest unscanned body over ~1.2s instead of snapping. Returns
   * the chosen target or null when nothing's in range.
   */
  frameNearestBody() {
    const MAX = 2500;
    const MIN = 50;
    let best: { dist: number; pos: THREE.Vector3; name: string; id: string } | null = null;
    for (const b of this.bodies) {
      if (b.scanned || b.isStar) continue;
      const d = b.mesh.position.distanceTo(this.ship.position);
      if (d > MAX || d < MIN + b.size) continue;
      if (!best || d < best.dist) {
        best = { dist: d, pos: b.mesh.position.clone(), name: b.name, id: b.id };
      }
    }
    if (!best) return null;
    const m = new THREE.Matrix4();
    const flipped = this.ship.position.clone().multiplyScalar(2).sub(best.pos);
    m.lookAt(this.ship.position, flipped, new THREE.Vector3(0, 1, 0));
    const to = new THREE.Quaternion().setFromRotationMatrix(m);
    this.frameTween = {
      from: this.ship.quaternion.clone(),
      to,
      elapsed: 0,
      duration: 1.2,
      targetId: best.id,
      targetName: best.name,
    };
    this.mouseX = 0;
    this.mouseY = 0;
    return { name: best.name, dist: best.dist };
  }

  /**
   * Toggle the approach autopilot. When engaged, `update()` follows a
   * Catmull-Rom spline toward a hold point at ~5 body-radii in front of the
   * target, steering with look-ahead and applying slew-rate-limited thrust so
   * the lever never snaps. Returns the chosen target (or null if nothing's reachable).
   */
  engageApproach(targetId?: string): { name: string; dist: number } | null {
    const MAX = 3000;
    let best: { dist: number; id: string; name: string; pos: THREE.Vector3; size: number } | null = null;
    if (targetId) {
      const b = this.bodies.find((x) => x.id === targetId);
      if (b && !b.isStar) {
        best = {
          dist: b.mesh.position.distanceTo(this.ship.position),
          id: b.id, name: b.name, pos: b.mesh.position.clone(), size: b.size,
        };
      }
    } else {
      for (const b of this.bodies) {
        if (b.scanned || b.isStar) continue;
        const d = b.mesh.position.distanceTo(this.ship.position);
        if (d > MAX) continue;
        if (!best || d < best.dist)
          best = { dist: d, id: b.id, name: b.name, pos: b.mesh.position.clone(), size: b.size };
      }
    }
    if (!best) return null;
    const path = this.buildApproachPath(best.pos, best.size);
    this.approach = {
      active: true, targetId: best.id, targetName: best.name, distance: best.dist,
      path, pathLength: path.getLength(), pathU: 0, smoothedThrust: 0,
      engagedAt: performance.now(),
    };
    return { name: best.name, dist: best.dist };
  }

  disengageApproach() {
    this.approach = {
      active: false, targetId: null, targetName: null, distance: 0,
      path: null, pathLength: 0, pathU: 0, smoothedThrust: 0, engagedAt: 0,
    };
    this.virtualThrust = 0;
    this.overrideState.approach.heldMs = 0;
    this.overrideState.approach.accum = 0;
  }

  /**
   * Per-frame override evaluator. Updates the held-duration + accumulated-input
   * trackers for one autopilot and returns true once either crosses the
   * configured threshold. The accumulator decays at ~1/1.5s per second so
   * brief glances/taps fade rather than building up forever.
   */
  private evaluateOverride(which: "flyby" | "approach", dt: number): boolean {
    const active =
      this.keys.has("KeyW") || this.keys.has("KeyS") ||
      this.keys.has("KeyA") || this.keys.has("KeyD") ||
      this.keys.has("KeyQ") || this.keys.has("KeyE") ||
      this.keys.has("ArrowUp") || this.keys.has("ArrowDown") ||
      this.keys.has("ArrowLeft") || this.keys.has("ArrowRight");
    const s = this.overrideState[which];
    if (active) {
      s.heldMs += dt * 1000;
      s.accum += dt;
    } else {
      s.heldMs = 0;
      s.accum = Math.max(0, s.accum - dt / 1.5);
    }
    const cfg = this.overrideConfig;
    return s.heldMs >= cfg.holdMs && cfg.holdMs > 0
      ? true
      : s.accum >= cfg.accumSec;
  }

  /**
   * Build a 4-point Catmull-Rom spline from the ship to a hold point ~5 radii
   * in front of the target. Two intermediate control points bend the path
   * around the ship's current heading so it doesn't immediately yank sideways.
   */
  private buildApproachPath(targetPos: THREE.Vector3, targetSize: number): THREE.CatmullRomCurve3 {
    const HOLD_R = 5; // hold distance in target radii
    const ship = this.ship.position.clone();
    const toTarget = targetPos.clone().sub(ship);
    const dist = toTarget.length();
    const dir = toTarget.clone().normalize();
    const holdPoint = targetPos.clone().sub(dir.clone().multiplyScalar(targetSize * HOLD_R));
    // Forward axis the ship is currently pointing.
    const shipFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    // First control: project a short way along current heading so the path
    // begins tangent to the ship's facing — no instant lateral jerk.
    const tangentDist = Math.min(dist * 0.25, 400);
    const c1 = ship.clone().add(shipFwd.clone().multiplyScalar(tangentDist));
    // Second control: ease into the hold approach vector for a smooth arrival.
    const c2 = holdPoint.clone().sub(dir.clone().multiplyScalar(targetSize * HOLD_R * 0.6));
    return new THREE.CatmullRomCurve3([ship, c1, c2, holdPoint], false, "catmullrom", 0.5);
  }

  /**
   * Engage cinematic flyby autopilot — picks the nearest non-star body and
   * builds an orbital path that loops the ship around it ~1.25 times at
   * periapsis altitude. The update loop steps along the orbit and slerps the
   * camera to keep the planet framed throughout. Returns target info or null.
   */
  engageFlyby(targetId?: string): { name: string; dist: number; altitude: number } | null {
    const MAX = 3500;
    let best: { dist: number; id: string; name: string; pos: THREE.Vector3; size: number } | null = null;
    if (targetId) {
      const b = this.bodies.find((x) => x.id === targetId);
      if (b && !b.isStar) {
        best = {
          dist: b.mesh.position.distanceTo(this.ship.position),
          id: b.id, name: b.name, pos: b.mesh.position.clone(), size: b.size,
        };
      }
    } else {
      for (const b of this.bodies) {
        if (b.isStar) continue;
        const d = b.mesh.position.distanceTo(this.ship.position);
        if (d > MAX) continue;
        if (!best || d < best.dist) best = { dist: d, id: b.id, name: b.name, pos: b.mesh.position.clone(), size: b.size };
      }
    }
    if (!best) return null;
    const cfg = this.flybyConfig;
    const altitude = best.size * cfg.altitudeMul;

    // Orbital plane: place ship on a circle of radius `altitude` around the
    // body. The in-plane basis (basisX, basisY) is built so the current ship
    // direction → body sits at angle 0; sweep proceeds counter-clockwise.
    const center = best.pos.clone();
    const toShip = this.ship.position.clone().sub(center);
    if (toShip.lengthSq() < 1e-4) toShip.set(1, 0, 0);
    const basisX = toShip.clone().normalize();
    // Plane normal: cross with world-up. Fall back to an alternate axis if
    // toShip is nearly parallel to up so the orbit always has a stable plane.
    let normal = new THREE.Vector3().crossVectors(basisX, new THREE.Vector3(0, 1, 0));
    if (normal.lengthSq() < 0.01) {
      normal = new THREE.Vector3().crossVectors(basisX, new THREE.Vector3(0, 0, 1));
    }
    normal.normalize();
    // Apply offsetMul as an initial plane tilt so the existing tuner control
    // still has a meaningful effect on the orbit's tilt at engage time.
    if (Math.abs(cfg.offsetMul) > 0.001) {
      const tiltAxis = basisX.clone();
      normal.applyAxisAngle(tiltAxis, cfg.offsetMul * 0.25).normalize();
    }
    const basisY = new THREE.Vector3().crossVectors(normal, basisX).normalize();

    this.flyby = {
      active: true,
      targetId: best.id,
      targetName: best.name,
      elapsed: 0,
      // Duration scales loosely with body size so big planets get a longer pass.
      // 1.25 laps at ~12s base feels cinematic without dragging.
      duration: (12 + Math.min(8, best.size * 0.18)) * cfg.durationMul,
      center,
      normal,
      basisX,
      basisY,
      radius: altitude,
      startAngle: 0,
      sweep: Math.PI * 2.5, // 1.25 laps
      nudgeRadius: 0,
      nudgeTilt: 0,
      nudgeLateral: 0,
      nudgeVertical: 0,
    };
    // Cancel competing autopilots.
    this.approach.active = false;
    this.frameTween = null;
    return { name: best.name, dist: best.dist, altitude };
  }

  disengageFlyby() {
    this.flyby.active = false;
    this.flyby.targetId = null;
    this.flyby.targetName = null;
    this.virtualThrust = 0;
    if (this.flybyPreviewLine) this.flybyPreviewLine.visible = false;
    this.overrideState.flyby.heldMs = 0;
    this.overrideState.flyby.accum = 0;
  }

  /**
   * Autopilot collision avoidance. Returns a small lateral offset (in world
   * units) that, when added to the autopilot's aim point, steers the ship
   * around any non-target body close to the ship→aim segment. Returns null
   * when the path is clear. The offset is perpendicular to the heading and
   * scales with how close the threat sits to the projected line, so brushing
   * past distant bodies costs almost nothing while a near-collision yields a
   * firm but smooth re-route. `excludeId` is the autopilot target — we never
   * dodge our own destination.
   */
  computeAvoidanceOffset(from: THREE.Vector3, aim: THREE.Vector3, excludeId: string | null): THREE.Vector3 | null {
    const seg = aim.clone().sub(from);
    const segLen = seg.length();
    if (segLen < 0.001) return null;
    const dir = seg.clone().multiplyScalar(1 / segLen);
    let total: THREE.Vector3 | null = null;
    for (const b of this.bodies) {
      if (b.id === excludeId) continue;
      // Safety radius: stars get a fat buffer; planets/moons a snug one.
      const safety = b.size * (b.isStar ? 2.4 : 1.6) + 40;
      const toBody = b.mesh.position.clone().sub(from);
      // Project onto the heading; ignore bodies behind us or far past the aim.
      const t = toBody.dot(dir);
      if (t < -safety || t > segLen + safety) continue;
      // Perpendicular distance from body center to the ray.
      const closest = from.clone().add(dir.clone().multiplyScalar(Math.max(0, Math.min(segLen, t))));
      const lateral = b.mesh.position.clone().sub(closest);
      const lateralLen = lateral.length();
      if (lateralLen > safety) continue;
      // Avoidance vector points AWAY from the body, perpendicular to heading.
      // Magnitude grows as the threat approaches the safety boundary.
      const proximity = 1 - lateralLen / safety; // 0..1
      let push = lateral.clone().multiplyScalar(-1 / Math.max(0.001, lateralLen));
      // If the body sits exactly on the line, pick a stable perpendicular.
      if (lateralLen < 0.001) {
        push = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
        if (push.lengthSq() < 0.01) push.set(1, 0, 0);
        push.normalize();
      }
      const strength = safety * proximity * proximity * 1.4;
      if (!total) total = new THREE.Vector3();
      total.addScaledVector(push, strength);
    }
    return total;
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
      name?: string;
    };

    const dots: Dot[] = [];
    let target: { dist: number; idx: number } | null = null;
    // Track nearest objective target across ALL distances (for off-radar arrow)
    let nearestTarget: { distance: number; dx: number; dz: number } | null = null;
    // Track nearest UNCATALOGUED body of any kind across ALL distances — drives
    // the always-on "next discovery" pointer on the star map.
    let nearestUnscanned: { distance: number; dx: number; dz: number } | null = null;

    const considerNearestTarget = (distance: number, dx: number, dz: number) => {
      if (!nearestTarget || distance < nearestTarget.distance) {
        nearestTarget = { distance, dx, dz };
      }
    };
    const considerNearestUnscanned = (distance: number, dx: number, dz: number) => {
      if (!nearestUnscanned || distance < nearestUnscanned.distance) {
        nearestUnscanned = { distance, dx, dz };
      }
    };

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      tmp.copy(b.mesh.position).applyMatrix4(inv);
      const distance = tmp.length();
      const isTargetCandidate =
        targetType !== null && targetType !== "orb" && b.type === targetType && !b.scanned;
      if (isTargetCandidate) considerNearestTarget(distance, tmp.x, tmp.z);
      // Always-on "next discovery" arrow: any uncatalogued, non-star body.
      if (!b.scanned && !b.isStar) considerNearestUnscanned(distance, tmp.x, tmp.z);
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
        name: b.name,
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

    // Always-on "next discovery" pointer (any uncatalogued body, any distance).
    // Normalized to a unit vector so the minimap can place the arrow on the rim.
    let nextUnscanned: { x: number; z: number; distance: number; inRange: boolean } | null = null;
    if (nearestUnscanned !== null) {
      const nu = nearestUnscanned as { distance: number; dx: number; dz: number };
      const len = Math.hypot(nu.dx, nu.dz) || 1;
      nextUnscanned = {
        x: nu.dx / len,
        z: nu.dz / len,
        distance: nu.distance,
        inRange: nu.distance <= range,
      };
    }

    return { dots, range, offRangeTarget, nextUnscanned };
  }

  /**
   * Lightweight serialisable snapshot of the ship's transform and forward
   * velocity — used by `useSpaceScene` to autosave and restore the pilot's
   * exact position/heading between sessions.
   */
  getSnapshot(): { pos: [number, number, number]; quat: [number, number, number, number]; velocity: number } {
    const p = this.ship.position;
    const q = this.ship.quaternion;
    return {
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w],
      velocity: this.velocity,
    };
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
    // Lightspeed lasts longer now — gives the pilot ~10s in hyperspace
    // before the next system materialises.
    this.warpTimer = 10;
    this.warpCharge = 0;
    (this.warpStars.material as THREE.PointsMaterial).opacity = 1;
    this.warpStars.visible = true;
    // Cinematic bloom flash — spike then ease back via update loop.
    this.bloomBoost = 2.4;
  }

  /**
   * Fires a 2-second speed burst with a 1-second cooldown. Returns true if
   * the burst actually engaged so the UI can play feedback.
   */
  /**
   * Bail out of an active lightspeed jump early. The warp loop in `update`
   * normally runs for ~10s after `triggerWarp`; this lets the pilot tap Space
   * to drop out at the current location instead of riding it out. No-op when
   * not warping, so it's safe to call from a generic Space-tap handler.
   */
  exitWarp() {
    if (!this.isWarping) return;
    this.warpTimer = 0;
    // Force an immediate teardown so the next-system rebuild fires this frame
    // rather than waiting for the warp tick to roll the timer past zero.
    this.isWarping = false;
    (this.warpStars.material as THREE.PointsMaterial).opacity = 0;
    this.warpStars.visible = false;
    // Intentionally do NOT increment systemSeed — early-exit keeps the pilot
    // in the system they're flying through.
  }

  triggerBoostBurst(): boolean {
    if (this.boostActive || this.boostCooldown > 0 || this.isWarping) return false;
    this.boostActive = true;
    this.boostTimer = this.BOOST_DURATION;
    return true;
  }

  update(dt: number) {
    if (this.paused) {
      this.composer.render();
      return;
    }

    // Cinematic flyby — orbital lap around the target. Position is
    // parameterized by an angle on the orbit plane; the ship sweeps ~1.25
    // laps so the pilot can study the day/night terminator, ring shadows,
    // and back-lit crescents. Cursor + WASD nudge the radius/tilt without
    // canceling — only the override threshold (W/S/A/D held long enough)
    // aborts the flyby.
    if (this.flyby.active) {
      const target = this.bodies.find((b) => b.id === this.flyby.targetId);
      if (!target) {
        this.disengageFlyby();
      } else if (this.evaluateOverride("flyby", dt)) {
        this.disengageFlyby();
      } else {
        // Re-anchor the orbit center to the (possibly moving) target so
        // moons / orbiting planets stay framed.
        this.flyby.center.copy(target.mesh.position);

        // Manual nudge channels: A/D + cursor X tweak orbital radius
        // (tighter / wider). W/S + cursor Y tilt the orbital plane.
        const maxRadiusNudge = target.size * 1.6;
        const maxTiltNudge = 0.6; // radians
        const radRate = target.size * 1.4;
        const tiltRate = 0.7;
        const decay = Math.exp(-dt * 0.5);
        const keyLat =
          (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) +
          (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? -1 : 0);
        const keyVert =
          (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) +
          (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? -1 : 0);
        this.flyby.nudgeRadius = THREE.MathUtils.clamp(
          this.flyby.nudgeRadius * decay + (this.mouseX + keyLat) * radRate * dt,
          -maxRadiusNudge, maxRadiusNudge,
        );
        this.flyby.nudgeTilt = THREE.MathUtils.clamp(
          this.flyby.nudgeTilt * decay + (-this.mouseY + keyVert) * tiltRate * dt,
          -maxTiltNudge, maxTiltNudge,
        );
        // Mirror onto compatibility aliases so the HUD nudge bars keep working.
        this.flyby.nudgeLateral = (this.flyby.nudgeRadius / Math.max(1, maxRadiusNudge)) * 60;
        this.flyby.nudgeVertical = (this.flyby.nudgeTilt / Math.max(0.001, maxTiltNudge)) * 60;

        this.flyby.elapsed += dt;
        const u = Math.min(1, this.flyby.elapsed / this.flyby.duration);
        // Smooth ease so start + end of the orbit don't lurch.
        const eased = u * u * (3 - 2 * u);
        const angle = this.flyby.startAngle + this.flyby.sweep * eased;
        // Bell envelope so radius/tilt nudges fade in over the lap.
        const env = Math.sin(Math.PI * u);
        const radius = this.flyby.radius + this.flyby.nudgeRadius * env;
        // Apply tilt by rotating the in-plane basis around basisX (tilts the orbit plane).
        const tiltAngle = this.flyby.nudgeTilt * env;
        const tilted = this.flyby.basisY.clone().applyAxisAngle(this.flyby.basisX, tiltAngle);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const pos = this.flyby.center.clone()
          .addScaledVector(this.flyby.basisX, cosA * radius)
          .addScaledVector(tilted, sinA * radius);

        // Collision avoidance: sample one short step ahead and push the
        // position away from any non-target body brushing the segment.
        const dAng = (this.flyby.sweep * 0.02);
        const nextAngle = angle + dAng;
        const nextPos = this.flyby.center.clone()
          .addScaledVector(this.flyby.basisX, Math.cos(nextAngle) * radius)
          .addScaledVector(tilted, Math.sin(nextAngle) * radius);
        const flybyAvoid = this.computeAvoidanceOffset(pos, nextPos, this.flyby.targetId);
        if (flybyAvoid) pos.add(flybyAvoid.multiplyScalar(0.5));
        this.ship.position.copy(pos);

        // Update the dashed ghost preview line: sample the REMAINING orbit
        // (current u → 1) with the same nudges applied so it bends live.
        {
          const line = this.flybyPreviewLine;
          line.visible = true;
          const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
          const segs = attr.count - 1;
          const tmp = new THREE.Vector3();
          for (let i = 0; i <= segs; i++) {
            const tu = u + (1 - u) * (i / segs);
            const teased = tu * tu * (3 - 2 * tu);
            const tAngle = this.flyby.startAngle + this.flyby.sweep * teased;
            const tEnv = Math.sin(Math.PI * tu);
            const tRadius = this.flyby.radius + this.flyby.nudgeRadius * tEnv;
            const tTiltAngle = this.flyby.nudgeTilt * tEnv;
            const tTilted = this.flyby.basisY.clone().applyAxisAngle(this.flyby.basisX, tTiltAngle);
            tmp.copy(this.flyby.center)
              .addScaledVector(this.flyby.basisX, Math.cos(tAngle) * tRadius)
              .addScaledVector(tTilted, Math.sin(tAngle) * tRadius);
            attr.setXYZ(i, tmp.x, tmp.y, tmp.z);
          }
          attr.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          line.computeLineDistances();
        }
        // Frame the planet — slerp ship orientation toward look-at(target).
        const m = new THREE.Matrix4();
        const flipped = pos.clone().multiplyScalar(2).sub(target.mesh.position);
        m.lookAt(pos, flipped, new THREE.Vector3(0, 1, 0));
        const desired = new THREE.Quaternion().setFromRotationMatrix(m);
        this.ship.quaternion.slerp(desired, Math.min(1, dt * 2.5));
        // Suppress velocity/thrust during flyby so the existing physics doesn't fight us.
        this.velocity = 0;
        this.virtualThrust = 0;
        if (u >= 1) this.disengageFlyby();
      }
    }

    // Approach autopilot — engaged via G key. Follows a Catmull-Rom spline
    // toward a hold point ~5 radii in front of the body, with look-ahead
    // steering and slew-rate-limited thrust so the lever never snaps.
    // Mouse/look just nudges the framing — only explicit thrust/roll/strafe
    // cancels so the pilot can glance around without losing the autopilot.
    if (this.approach.active) {
      // Approach ends when: (a) explicit abort hotkey (G/X/B handlers call
      // disengageApproach directly), (b) target vanishes / fully scanned, or
      // (c) the configurable manual-override threshold is crossed (held long
      // enough OR enough accumulated tap-input on thrust/strafe/roll keys).
      const target = this.bodies.find((b) => b.id === this.approach.targetId);
      if (!target || target.scanned) {
        this.disengageApproach();
      } else if (this.evaluateOverride("approach", dt)) {
        this.disengageApproach();
      } else {
        // If the target body has drifted (orbital motion) or the spline got
        // stale, rebuild it. Cheap — just 4 control points.
        const path = this.approach.path;
        if (!path) {
          this.approach.path = this.buildApproachPath(target.mesh.position, target.size);
          this.approach.pathLength = this.approach.path.getLength();
          this.approach.pathU = 0;
        } else {
          const endPoint = path.getPoint(1);
          const dirNow = target.mesh.position.clone().sub(this.ship.position).normalize();
          const expectedHold = target.mesh.position.clone().sub(dirNow.multiplyScalar(target.size * 5));
          if (endPoint.distanceTo(expectedHold) > target.size * 1.2) {
            this.approach.path = this.buildApproachPath(target.mesh.position, target.size);
            this.approach.pathLength = this.approach.path.getLength();
            this.approach.pathU = Math.min(this.approach.pathU, 0.85);
          }
        }
        const spline = this.approach.path!;
        // Find the closest u on the spline to the ship by stepping a short
        // window forward from the cached pathU. Keeps sampling local + cheap.
        let bestU = this.approach.pathU;
        let bestSq = Infinity;
        const SAMPLES = 12;
        const window = 0.15;
        for (let i = 0; i <= SAMPLES; i++) {
          const u = Math.max(0, Math.min(1, this.approach.pathU - window + (i / SAMPLES) * window * 2));
          const p = spline.getPoint(u);
          const sq = p.distanceToSquared(this.ship.position);
          if (sq < bestSq) { bestSq = sq; bestU = u; }
        }
        this.approach.pathU = bestU;
        // Look ahead ~80u along the path for the steering target. Near the
        // end, lock onto the actual planet so the camera frames it for scanning.
        const lookAheadU = Math.min(1, bestU + 80 / Math.max(1, this.approach.pathLength));
        let aimPoint = bestU > 0.92 ? target.mesh.position.clone() : spline.getPoint(lookAheadU);
        // Collision avoidance: if any non-target body sits near the segment
        // between ship and aim point, push the aim sideways by its safety
        // radius. Strength falls off with distance so it only kicks in for
        // genuine near-miss trajectories. Applied LAST so the framing target
        // (when bestU > 0.92) is also re-routed if needed.
        const avoid = this.computeAvoidanceOffset(this.ship.position, aimPoint, target.id);
        if (avoid) aimPoint = aimPoint.clone().add(avoid);
        const m = new THREE.Matrix4();
        const flipped = this.ship.position.clone().multiplyScalar(2).sub(aimPoint);
        m.lookAt(this.ship.position, flipped, new THREE.Vector3(0, 1, 0));
        const desired = new THREE.Quaternion().setFromRotationMatrix(m);
        this.ship.quaternion.slerp(desired, Math.min(1, dt * 1.8));

        // Distance-based thrust target, then slew-rate-limited so the lever
        // never changes faster than ~0.6 units/second. Also fades in over 1s.
        const dist = target.mesh.position.distanceTo(this.ship.position);
        const r = target.size;
        let targetThrust = 0;
        if (dist > r * 8) targetThrust = 1;
        else if (dist > r * 5) targetThrust = (dist - r * 5) / (r * 3);
        else targetThrust = 0;
        const sinceEngage = (performance.now() - this.approach.engagedAt) / 1000;
        const fadeIn = Math.min(1, sinceEngage / 1.0);
        targetThrust *= fadeIn;
        // Heading-aware brake: ease off thrust if not yet aligned with the aim
        // point, so the ship doesn't barrel sideways during the initial turn.
        const shipFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
        const aimDir = aimPoint.clone().sub(this.ship.position).normalize();
        const align = Math.max(0, shipFwd.dot(aimDir));
        targetThrust *= 0.3 + 0.7 * align;
        const SLEW = 0.6;
        const delta = targetThrust - this.approach.smoothedThrust;
        const maxStep = SLEW * dt;
        this.approach.smoothedThrust += Math.max(-maxStep, Math.min(maxStep, delta));
        this.virtualThrust = this.approach.smoothedThrust;
        this.approach.distance = dist;
      }
    }

    // Steering from mouse
    const yawRate = -this.mouseX * 0.8;
    const pitchRate = -this.mouseY * 0.8;
    this.ship.rotateY(yawRate * dt);
    this.ship.rotateX(pitchRate * dt);

    // Roll: A/D / arrows + Q/E feed an angular-velocity model so banking
    // ramps up smoothly and decays after release instead of snapping. Tunables
    // below let us trade snap (high accel/damping) for cinematic float
    // (low damping). Max rate caps top angular speed regardless of input.
    let rollInput = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rollInput += 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rollInput -= 1;
    if (this.keys.has("KeyQ")) rollInput += 1;
    if (this.keys.has("KeyE")) rollInput -= 1;
    // Accelerate toward (input * MAX_ROLL_RATE); when input is 0, damping
    // pulls velocity back to zero so the ship slowly levels out on its own.
    const targetRollVel = rollInput * this.ROLL_MAX_RATE;
    const k = rollInput !== 0 ? this.ROLL_ACCEL : this.ROLL_DAMPING;
    this.rollVel += (targetRollVel - this.rollVel) * Math.min(1, dt * k);
    if (Math.abs(this.rollVel) < 0.001) this.rollVel = 0;
    this.ship.rotateZ(this.rollVel * dt);

    // Smooth "frame target" tween — F key rotates the camera toward a chosen
    // body over ~1.2s so the pilot can compose the shot without snap-cuts.
    if (this.frameTween) {
      const t = this.frameTween;
      t.elapsed = Math.min(t.duration, t.elapsed + dt);
      const u = t.elapsed / t.duration;
      const e = u * u * (3 - 2 * u); // smoothstep
      this.ship.quaternion.copy(t.from).slerp(t.to, e);
      if (t.elapsed >= t.duration) this.frameTween = null;
    }

    // Thrust — combine keyboard with continuous virtual input (mobile slider).
    let thrustInput = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) thrustInput += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) thrustInput -= 0.6;
    thrustInput += this.virtualThrust;
    thrustInput = Math.max(-1, Math.min(1, thrustInput));
    // Tick boost-burst + cooldown timers (Space-tap burst, separate from Shift).
    if (this.boostActive) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boostActive = false;
        this.boostCooldown = this.BOOST_COOLDOWN;
      }
    } else if (this.boostCooldown > 0) {
      this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    }
    const shiftBoost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2.5 : 1;
    const burstBoost = this.boostActive ? this.BOOST_MULT : 1;
    this.boost = Math.max(shiftBoost, burstBoost);
    this.thrust = thrustInput;

    // Approach mode — taper max velocity near a body and surface a proximity
    // hint so the HUD can fade an atmospheric vignette in close-flyby.
    let nearestProx: { dist: number; size: number; color: string } | null = null;
    for (const b of this.bodies) {
      if (b.isStar) continue;
      const d = b.mesh.position.distanceTo(this.ship.position);
      const reach = b.size * 6;
      if (d < reach && (!nearestProx || d / b.size < nearestProx.dist / nearestProx.size)) {
        nearestProx = { dist: d, size: b.size, color: b.color };
      }
    }
    this.proximity = nearestProx
      ? { closeness: 1 - Math.min(1, nearestProx.dist / (nearestProx.size * 6)), color: nearestProx.color }
      : null;

    // Scan-range ring: counter-rotate against ship pitch/yaw so it stays a
    // world-aligned disc on the XZ plane, then animate sweep + recolor based
    // on how close any body is to the ring boundary. Bodies entering the ring
    // make it pulse cyan; close proximity tints it amber.
    if (this.scanRingGroup) {
      this.scanRingTime += dt;
      // Counter the ship's local rotation so the ring stays world-flat.
      const inv = this.ship.quaternion.clone().invert();
      this.scanRingGroup.quaternion.copy(inv);
      // Find the body closest to the ring's edge (positive = inside, negative = outside).
      let edgeProximity = 0; // 0..1 — how close a body is to entering / how deep inside
      let nearestRingBody: { dist: number; color: string } | null = null;
      for (const b of this.bodies) {
        const d = b.mesh.position.distanceTo(this.ship.position);
        if (d > this.SCAN_RING_RADIUS * 1.2) continue;
        // Stronger signal as bodies approach the ring boundary or are inside.
        const signal = 1 - Math.min(1, Math.abs(d - this.SCAN_RING_RADIUS * 0.7) / (this.SCAN_RING_RADIUS * 0.7));
        if (signal > edgeProximity) {
          edgeProximity = signal;
          nearestRingBody = { dist: d, color: b.color };
        }
      }
      const pulse = 0.5 + 0.5 * Math.sin(this.scanRingTime * 2.4);
      const baseOpacity = 0.12 + edgeProximity * 0.35 + pulse * 0.06 * edgeProximity;
      const ringColor = new THREE.Color(0x66ddff);
      if (nearestRingBody && edgeProximity > 0.2) {
        ringColor.lerp(new THREE.Color(nearestRingBody.color), Math.min(0.85, edgeProximity));
      }
      const outerMat = this.scanRingOuter.material as THREE.MeshBasicMaterial;
      const innerMat = this.scanRingInner.material as THREE.MeshBasicMaterial;
      outerMat.color.copy(ringColor);
      innerMat.color.copy(ringColor);
      outerMat.opacity = baseOpacity;
      innerMat.opacity = baseOpacity * 0.55;
      // Slow rotational sweep for ambient motion.
      this.scanRingOuter.rotation.z = this.scanRingTime * 0.15;
      this.scanRingInner.rotation.z = -this.scanRingTime * 0.22;
    }

    const approachTaper =
      nearestProx && nearestProx.dist < nearestProx.size * 4
        ? 0.7 + 0.3 * (nearestProx.dist / (nearestProx.size * 4))
        : 1;

    const targetVel = thrustInput * 60 * this.boost * approachTaper;
    this.velocity += (targetVel - this.velocity) * Math.min(1, dt * 1.2);
    if (Math.abs(this.velocity) < 0.05) this.velocity = 0;

    // Move ship along its forward (-Z)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quaternion);
    this.ship.position.addScaledVector(forward, this.velocity * dt);

    // Planet collision: if the ship enters a body's "hull" radius, push it out
    // along the surface normal so it slides around the atmosphere instead of
    // tunneling through. Skipped during warp so jumps aren't snagged.
    if (!this.isWarping) {
      const pushOut = new THREE.Vector3();
      for (const b of this.bodies) {
        // Atmospheric buffer: stars get a wider exclusion (corona), planets a
        // small skin above the surface so you can graze the edge.
        const buffer = b.isStar ? b.size * 1.4 : b.size * 1.08;
        pushOut.copy(this.ship.position).sub(b.mesh.position);
        const d = pushOut.length();
        if (d > 0 && d < buffer) {
          pushOut.multiplyScalar(buffer / d);
          this.ship.position.copy(b.mesh.position).add(pushOut);
          // Cancel inward velocity component so we slide tangentially rather
          // than grinding into the surface.
          const normal = pushOut.normalize();
          const inward = forward.dot(normal);
          if (inward < 0) this.velocity *= 0.6;
        }
      }
    }

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
    // Track the nearest aligned ALREADY-scanned body so we can show a small
    // "already catalogued" cyan hint on the reticle without re-running the scan.
    let alreadyScannedHit: Body | null = null;
    let alreadyScannedDist = Infinity;
    for (const b of this.bodies) {
      toBody.copy(b.mesh.position).sub(this.ship.position);
      const dist = toBody.length();
      if (dist > MAX_LOCK_RANGE) {
        if (!b.scanned) b.aimTime = 0;
        continue;
      }
      toBody.divideScalar(dist || 1);
      const angularRadius = Math.min(0.2, b.size / Math.max(dist, 1));
      const aligned = aimForward.dot(toBody) >= AIM_COS - angularRadius;
      if (b.scanned) {
        if (aligned && dist < alreadyScannedDist) {
          alreadyScannedHit = b;
          alreadyScannedDist = dist;
        }
        continue;
      }
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
      this.callbacks.onScanProgress({ name: b.name, progress: scanning.progress, alreadyScanned: false });
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

        // System completion: id prefix before the first '-' identifies a system
        // (e.g. "sol-earth" → "sol", "s12345-b3-m1" → "s12345"). When every
        // body sharing that prefix is scanned, fire the medal callback.
        const systemId = b.id.split("-")[0];
        const peers = this.bodies.filter((x) => x.id.split("-")[0] === systemId);
        if (peers.length > 1 && peers.every((x) => x.scanned)) {
          const star = peers.find((x) => x.isStar);
          this.callbacks.onSystemComplete({
            systemId,
            systemName: star?.name ?? systemId.toUpperCase(),
            bodyCount: peers.length,
          });
        }
      }
    } else if (alreadyScannedHit) {
      // Cyan "already catalogued" reticle hint (progress=1 + flag).
      this.callbacks.onScanProgress({
        name: alreadyScannedHit.name,
        progress: 1,
        alreadyScanned: true,
      });
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
      // Drive shader uniforms (time + sun direction in world space, pointing
      // FROM planet TO sun) plus a proximity factor that ramps up close-up
      // detail (rim brightness, cloud contrast, micro-octave terrain).
      if (b.shaderMat) {
        sunDirTmp.copy(sunPos).sub(b.mesh.position);
        if (sunDirTmp.lengthSq() < 1e-6) sunDirTmp.set(1, 0.3, 0.5);
        sunDirTmp.normalize();
        let prox = 0;
        if (!b.isStar) {
          const d = b.mesh.position.distanceTo(this.ship.position);
          prox = Math.max(0, Math.min(1, 1 - d / Math.max(1, b.size * 8)));
        }
        tickPlanetUniforms(b.shaderMat, nowSec, sunDirTmp, prox);
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
