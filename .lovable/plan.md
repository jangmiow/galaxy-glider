

## Goal
Two pilot-experience fixes:
1. **Auto-save & resume**: when you launch /play, the ship spawns at the exact position, orientation, and current target it had when you left — not at the system origin.
2. **Better flyby + closer-up planet detail**: the flyby actually orbits the planet so you can study it from multiple angles, and surface detail (clouds, atmosphere rim, terrain shading) intensifies as you get close.

---

## Part 1 — Auto-save / resume

### What you'll see
- Quit /play (close tab, navigate away, refresh) → relaunch → the cockpit comes back exactly where it was: same system, same ship position, same heading, same velocity, same scan progress on whatever you were locked onto.
- A subtle "RESUMED" toast on respawn so you know the save loaded.
- Saves happen automatically every ~3 seconds during flight, on pause, and on tab unload — no manual save button.

### Technical changes
**`src/lib/pilots.ts`** — add a `PilotFlightState` blob and helpers:
```ts
type PilotFlightState = {
  systemSeed: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  velocity: number;
  savedAt: number;
};
loadFlightState(pilotId): PilotFlightState | null
saveFlightState(pilotId, state): void
```
Stored under `cosmic-drift:p:{id}:flight` (deleted alongside other pilot data in `deletePilot`).

**`src/hooks/useSpaceScene.ts`**:
- After scene init + `buildSystem(savedSeed)`, call `loadFlightState` and apply pos/quat/velocity to `scene.ship` and `scene.velocity`. Show toast "RESUMED · {systemName}".
- Inside the existing 10 fps minimap tick, also serialize and persist `PilotFlightState` if it changed meaningfully (pos delta > 5u OR every 3s, whichever first).
- Add a `beforeunload` listener that flushes the latest state synchronously.
- Flush on `togglePause` (when entering paused) and on hook cleanup.

**`src/components/SpaceScene.ts`** — expose `velocity` (already public) and add a small `getSnapshot()` returning `{ pos, quat, velocity }` to keep the hook clean.

### Out of scope
- Saving scan-in-progress percentage (resets to 0 on resume — scanning takes <2s anyway).
- Saving boost/warp cooldown timers (start fresh).
- Cross-device sync. Pure localStorage, per-pilot, single device.

---

## Part 2 — Flyby that orbits, plus close-up planet detail

### What you'll see
- Engaging flyby (double-click a planet) now flies a **full orbital lap** at periapsis altitude — roughly 1.25 turns around the planet — instead of a single bezier arc that exits past the far side. You see the day/night terminator pass, ring shadows (if any), and back-lit crescents.
- The orbit is gentle and cinematic: ~16 seconds default (scaled by `durationMul`), with the camera always framed on the planet center.
- A/D nudge widens/tightens the orbit (altitude), W/S tilts the orbital plane, mouse provides fine offset — same controls, but applied to orbit parameters instead of curve nudges.
- **Closer = more detail**: as your distance to the planet drops below ~4× radius, the planet's atmosphere rim brightens, cloud cover gains contrast, and terrain shading sharpens. Gas giants reveal banding detail; rocky worlds show stronger terrain albedo. This is driven by a new `uProximity` shader uniform.
- Sphere mesh tessellation is bumped from 64×48 to 96×72 for non-star bodies so silhouettes stay round at flyby altitude.

### Technical changes

**`src/components/SpaceScene.ts` — replace bezier flyby with orbital flyby**:
- Replace `flyby.{p0..p3, perp, up}` state with orbit params:
  ```ts
  flyby: {
    active, targetId, targetName, elapsed, duration,
    center: Vector3, normal: Vector3, // orbital plane
    radius: number,                    // periapsis altitude
    startAngle: number, sweep: number, // 1.25 turns = 2.5π
    nudgeRadius: number, nudgeTilt: number,
  }
  ```
- `engageFlyby`: place ship on a circle at `target.size × altitudeMul`, with `normal` derived from cross(toShip, world-up). Sweep = `2.5π` (1.25 laps). Duration = `12 + size*0.18` × `durationMul`.
- Update loop: compute `angle = startAngle + sweep × easeInOut(u)`, position = `center + (cos(angle)*basisX + sin(angle)*basisY) * (radius + nudgeRadius*env)`; tilt the basis by `nudgeTilt*env`. Camera lookAt(center) as today.
- Preview line resampled along the same orbital arc.
- Collision avoidance unchanged.

**`src/components/planetShaders.ts`** — add proximity uniform:
- Add `uProximity: { value: number }` (0 = far, 1 = right at the surface) to `PlanetUniforms`.
- In each fragment shader (rocky/gas/ocean/icy/lava/barren), mix in extra detail layers when `uProximity > 0`:
  - Rim/atmosphere brightness: `atmoTerm *= mix(1.0, 1.6, uProximity)`.
  - Cloud contrast: amplify cloud noise output by `mix(1.0, 1.4, uProximity)`.
  - Gas bands: blend in a higher-frequency fbm octave at proximity.
- Extend `tickPlanetUniforms(mat, time, sunDir, proximity)` to set the new uniform.

**`src/components/SpaceScene.ts` update loop**:
- Each frame, for every body with `shaderMat`, compute `prox = clamp(1 - dist/(size*8), 0, 1)` and pass it to `tickPlanetUniforms`. Cheap — already iterating bodies.
- Bump non-star `SphereGeometry` to `(size, 96, 72)`.

### Out of scope
- New planet kinds or texture maps.
- Real ring shadow casting (already approximated via shaders).
- Surface terrain heightmaps / displacement.

---

## Files touched
- `src/lib/pilots.ts` — add `PilotFlightState` + load/save/delete.
- `src/hooks/useSpaceScene.ts` — restore on init, periodic + unload save, "RESUMED" toast.
- `src/components/SpaceScene.ts` — orbital flyby refactor, proximity per-body, geometry bump, optional `getSnapshot`.
- `src/components/planetShaders.ts` — `uProximity` uniform + per-shader detail mix, signature change to `tickPlanetUniforms`.

## Risks / notes
- `tickPlanetUniforms` signature change: a single call site in the scene update loop — easy to update in one pass.
- Orbital flyby changes the feel of the existing tuners; `altitudeMul` keeps its meaning, `offsetMul` becomes "orbital tilt offset" (still bipolar), `durationMul` still scales total time. The `FlybyPanel` HUD copy stays accurate.
- Geometry bump (96×72) ≈ 2.25× verts per body but still trivial for 5–10 bodies/system.

