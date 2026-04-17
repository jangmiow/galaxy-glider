
# Cosmic Drift — First-Person Spaceship Explorer

A cinematic, first-person cockpit experience where you pilot a ship through a procedurally generated galaxy, discovering planets and stars, with optional light objectives.

## Core experience
- **View**: First-person from inside the cockpit. A subtle dark cockpit frame (dashboard silhouette + window struts) overlays a huge curved windscreen showing space.
- **Space**: Real 3D scene built with Three.js — thousands of stars with parallax depth, drifting nebula clouds (volumetric-style sprites), distant galaxy disks, planets of varied size/color/rings, glowing suns with lens flares.
- **Atmosphere**: Cinematic bloom, subtle vignette, ambient cockpit hum + soft synth pad, engine rumble that scales with thrust, whoosh on light-speed jump.

## Controls
- **Mouse**: Move cursor to pitch & yaw the ship (smooth, with deadzone in center). Right-click drag for roll (optional).
- **Keyboard**: `W` / `↑` thrust forward, `S` / `↓` reverse thrust, `A` `D` / `← →` strafe-turn assist, `Shift` boost, `Space` engage light speed, `Esc` pause.
- **On-screen hint overlay** that fades after first input.

## HUD (sleek sci-fi style, layered over the cockpit)
- Velocity readout + thrust bar
- Heading compass / artificial horizon
- Mini radar showing nearby points of interest
- Light-speed charge indicator
- Discovery log button (top-right)

## Gameplay (combining all three scopes)
1. **Free flight**: Thrust, turn, drift. Stars streak past faster as velocity rises.
2. **Light speed**: Tap `Space` → screen warps into the classic star-tunnel effect for a few seconds, then drops you near a new star system. Cooldown bar refills.
3. **Discoveries**: Fly close to a planet/star → it auto-scans → entry added to a **Discovery Journal** (name, type, size, color, distance from origin). Procedurally generated names (e.g., "Kepler-VX 7", "Nyx Prime").
4. **Mini-objectives**: Rotating soft goals shown subtly in HUD — "Reach the blue giant", "Discover 3 ringed planets", "Collect 5 energy orbs". Completing them increases a **Pilot Rank**.
5. **Energy orbs**: Occasionally float in space; flying through them gives a small score + brief boost.

## Pages / routes
- `/` — Main menu: title "COSMIC DRIFT", Start, Controls, About. Animated star background.
- `/play` — The full cockpit game (Three.js canvas + HUD overlays).
- `/journal` — Discovery log (persisted in localStorage): grid of discovered bodies with thumbnails and stats.

## Design direction
- Realistic & cinematic: deep blacks, soft cyan/amber HUD accents, thin futuristic typography (Orbitron or similar), crisp lens flares, subtle film grain.
- Cockpit frame rendered as SVG/PNG overlay so it stays sharp at any resolution.
- Mobile fallback: on-screen joystick + thrust slider; warns desktop is recommended.

## Performance
- Use instanced meshes for stars, sprite-based nebulae, level-of-detail planets, and frustum culling so it runs smoothly in the browser.

## Out of scope (for v1)
- Combat / enemies / weapons
- Multiplayer
- Landing on planets
- Saving across devices (journal stays in localStorage)

We can layer any of these in later iterations.
