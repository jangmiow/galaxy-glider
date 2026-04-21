
## Bigger, more cinematic worlds — Project Hail Mary inspired

Goal: make planets feel like real, awe-inspiring objects (the way Rocky's Erid or Tau Ceti feel in PHM) without breaking scan ranges, orbits, or collision. Pair the visual upgrade with a few control polish items so flying near a giant feels deliberate.

### 1. Planet & moon size pass

Bump body sizes meaningfully while keeping stars dominant and orbits readable.

**Sol system (`buildSolSystem`)** — multipliers chosen per body so terrestrials grow more than gas giants (which are already huge):
- Mercury 6 → 9, Venus 10 → 16, Earth 11 → 18, Mars 8 → 13
- Jupiter 40 → 58, Saturn 34 → 50 (rings scale with `size`, so they grow automatically; bump `inner/outer` to 80/150)
- Uranus 20 → 30, Neptune 19 → 28
- Sun stays 80 (already cinematic; growing it crowds inner planets)
- Moons scaled ~1.4× (Luna 2.2 → 3.2, Titan 2.6 → 3.8, Ganymede 3.0 → 4.4, etc.) and moon orbital `radius` grown ~1.3× so they don't clip the now-larger parent

**Procedural systems (`buildSystem`)**:
- Terrestrial size band: `9 + rng()*11` → `15 + rng()*14` (15–29u)
- Gas/ringed band: `26 + rng()*24` → `38 + rng()*32` (38–70u)
- Orbital spacing `330 + i*240` → `420 + i*310` so larger bodies don't visually overlap
- Moon orbital radius coefficient `2.4 + m*1.1` → `2.8 + m*1.2` for the same reason

### 2. Visual polish to sell scale

- **Atmosphere rim**: in `addPlanetBody`, slightly raise `uAtmoStrength` default for terrestrial kinds (rocky/ocean/icy) so the limb glow is more pronounced on close approach — this is the single biggest "looks real" lever
- **Bloom threshold**: lower `UnrealBloomPass` threshold from `0.2` → `0.15` so atmospheres and ring-lit edges catch a touch more bloom (stars already saturate, so the change mainly benefits planets)
- **Approach awe**: when the ship is within `b.size * 6` of any planet, fade in a subtle vignette tint matching the body's atmosphere color (reuses existing boost-vignette CSS class with a new `.proximity-vignette` variant driven from HUD state)

### 3. Controls polish for piloting near giants

- **Variable thrust ramp**: current thrust accelerates at one rate. Add a soft cap that tapers max velocity to 70% within `b.size * 4` of any body — gives a natural "approach mode" feel and prevents tunneling past a planet you're trying to admire
- **Q/E roll keys**: bank the ship on its forward axis (currently no roll). Pure cosmetic / framing tool — essential for taking in a ringed giant from the right angle
- **F key — frame target**: smoothly rotates the camera to face the nearest unscanned body over ~1.2s. Complements the existing `T` auto-aim (which snaps) with a cinematic version
- Update `KeyBindingsHUD` to show Q/E/F

### 4. Compatibility checks (no breakage)

- Scan/lock-on uses `b.size / dist` for `angularRadius` — bigger planets become easier to lock from farther, which is the intended feel
- Collision buffer is `b.size * 1.08` (planet) / `b.size * 1.4` (star) — still proportional, no tuning needed
- Star flare uses `b.size * 10` for sprite scale — already proportional
- Minimap dot sizes are based on body type, not `size`, so visual scale on the radar is unchanged

### Files touched
- `src/components/SpaceScene.ts` — sizes, orbital spacing, bloom threshold, thrust taper near bodies, Q/E roll, F frame-target action, atmosphere strength tweak
- `src/hooks/useSpaceScene.ts` — wire Q/E/F keys, surface `proximityBody` (color + closeness) into HUD state
- `src/components/CockpitHUD.tsx` — render the proximity vignette overlay
- `src/components/KeyBindingsHUD.tsx` — show Q/E/F caps
- `src/styles.css` — `.proximity-vignette` keyframe / utility

No new dependencies. No persistence schema changes (the migration system is untouched).
