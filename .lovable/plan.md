

## Goal
Let the pilot click HUD elements (pause, minimap zoom, flyby tuners) without the mouse breaking flight steering, and add a clearly visible **PAUSE** button.

## What you'll see
- A new **PAUSE** button pinned **top-right** of the cockpit, next to the mute button. Round, HUD-styled, with a `❚❚` icon that flips to `▶` when paused. Tooltip shows "Pause (Esc)".
- The button sits in a small "safe zone" — a 64×64 area where the mouse will **not** steer the ship, so you can move to it without the cockpit tilting.
- A subtle outlined chip underneath shows the current state ("FLIGHT" / "PAUSED") so it reads at a glance.
- All existing HUD panels (minimap zoom buttons, flyby tuner sliders, debug etc.) remain clickable — they already are, but we'll make the affordance clearer with a faint hover ring on interactive HUD controls.

## How clicks stay out of the way of flight
Mouse-look and click-to-approach are bound to the `<canvas>` element directly (not `window`), and the click handler already early-returns when `e.target !== canvas`. So any HUD element with `pointer-events-auto` is automatically safe — clicking it will **not** trigger approach/flyby/abort.

The only remaining issue is **mouse-look drift**: moving the cursor up to reach the pause button currently yaws the ship. Fix: introduce HUD "dead zones" where `mousemove` is ignored.

## Technical changes

**1. `src/components/PauseButton.tsx` (new)**
- Small component mirroring `MuteButton`'s style.
- Props: `paused: boolean`, `onToggle: () => void`.
- Positioned `absolute top-6 right-6` (mute button shifts to `right-20`).
- Uses `pointer-events-auto` and `data-hud-safe="true"` attribute (see step 3).

**2. `src/routes/play.tsx`**
- Render `<PauseButton paused={hud.paused} onToggle={controller.togglePause} />`.
- Move `<MuteButton>` left to make room (or stack vertically).

**3. `src/hooks/useSpaceScene.ts` — mouse-look dead zone**
- In `onMove`, check `e.target` and walk up via `closest('[data-hud-safe="true"]')`. If matched, skip `scene.setMouse(...)` for that frame and zero out the steering delta so the ship stops drifting toward the button.
- Tag the pause button, mute button, and minimap wrapper with `data-hud-safe="true"`.
- This is a 4-line change inside the existing `onMove` handler.

**4. `src/components/CockpitHUD.tsx` — light polish**
- Add a `hover:ring-1 hover:ring-hud/40` class to interactive controls in the flyby tuner so users see they're clickable.
- No structural changes to the pause overlay itself (already done in prior turn).

## Files touched
- `src/components/PauseButton.tsx` (new, ~40 lines)
- `src/routes/play.tsx` (add import + render)
- `src/hooks/useSpaceScene.ts` (dead-zone check in `onMove`, ~5 lines)
- `src/components/MuteButton.tsx` (shift position or accept a `className` prop)
- `src/components/Minimap.tsx` + `src/components/CockpitHUD.tsx` (add `data-hud-safe` attr on wrappers)

## Out of scope
- No change to keyboard controls. `Esc` still pauses.
- No change to the existing fullscreen pause menu.
- No change to click-to-approach / double-click-to-flyby behavior.

