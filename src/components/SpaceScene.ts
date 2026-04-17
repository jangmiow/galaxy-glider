import * as THREE from "three";
import { generateName, saveDiscovery, type Discovery } from "@/lib/journal";

type Body = {
  mesh: THREE.Mesh;
  type: Discovery["type"];
  size: number;
  color: string;
  id: string;
  name: string;
  scanned: boolean;
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

export class SpaceScene {
  renderer: THREE.WebGLRenderer;
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
    const mat = new THREE.PointsMaterial({ color: 0xaaddff, size: 2, transparent: true, opacity: 0 });
    this.warpStars = new THREE.Points(geo, mat);
    this.camera.add(this.warpStars);
  }

  buildNebulae() {
    const colors = [0x4466aa, 0xaa4466, 0x6644aa, 0xaa8844];
    for (let i = 0; i < 8; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      const c = colors[i % colors.length];
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
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

      const geo = new THREE.SphereGeometry(size, 32, 24);
      const mat = isStar
        ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color) })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(angle) * dist, elev, Math.sin(angle) * dist);

      if (isStar) {
        // Glow sprite
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        const c = new THREE.Color(color);
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, `rgba(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0},0.9)`);
        grad.addColorStop(0.4, `rgba(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0},0.3)`);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0,0,256,256);
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sprite.scale.set(size * 6, size * 6, 1);
        mesh.add(sprite);

        const light = new THREE.PointLight(new THREE.Color(color), 1.2, 600);
        mesh.add(light);
      }

      if (type === "ringed-planet") {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(size * 1.4, size * 2.2, 64),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
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

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  triggerWarp() {
    if (this.warpCharge < 1 || this.isWarping) return;
    this.isWarping = true;
    this.warpTimer = 2.5;
    this.warpCharge = 0;
    (this.warpStars.material as THREE.PointsMaterial).opacity = 1;
  }

  update(dt: number) {
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
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

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearSystem();
    this.renderer.dispose();
  }
}
