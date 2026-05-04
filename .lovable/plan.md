## Goal
Add a **Galaxy Map** overlay with a procedural star chart of nearby systems. Click any system to jump straight to it — no more "warp = +1 system only".

## What you'll see
- A new **GALAXY** button on the minimap header (next to the zoom controls).
- Click it → fullscreen **Galaxy Map** modal (semi-transparent over the cockpit).
- 24 procedurally-placed star nodes around your current system, each labelled with its name + sector code. Current system marked at center with a "YOU ARE HERE" ring; visited systems shown solid; unvisited shown hollow.
- Hover a node → tooltip with name, sector, distance (in jumps), and star type.
- Click a node → confirmation chip ("JUMP TO {NAME}? [J] CONFIRM / [ESC] CANCEL"). Pressing **J** (or clicking again) engages warp directly to that seed.
- During warp the existing LIGHTSPEED overlay shows the chosen destination's name + sector (already implemented).
- Press **M** or **Esc** (or click the X) to close the map.

## Architecture

```text
[Minimap header] --click GALAXY--> [GalaxyMap modal]
                                         |
                                         | onJumpTo(targetSeed)
                                         v
                              useSpaceScene.warpTo(seed)
                                         |
                                         v
                              SpaceScene.triggerWarp(seed?)  // new optional arg
                                         |
                                  warpTimer ticks down
                                         v
                              buildSystem(seed) on completion
```

## Files to change

**New**
- `src/components/GalaxyMap.tsx` — modal with SVG starfield, hover/select state, jump confirmation. ~150 LOC.
- `src/lib/galaxy.ts` — pure helper. `getNearbySystems(currentSeed, count = 24)` deterministically generates `{ seed, name, sector, x, y, kind, distance }` placed in a ring around the current seed. Uses the existing `generateName` and the new `sectorFor` helper (extracted from `useSpaceScene.ts` into this module so both can share it).

**Edited**
- `src/components/SpaceScene.ts` — `triggerWarp(targetSeed?: number)` accepts an optional explicit destination; if provided, the seed jump at completion uses it instead of `systemSeed + 1`. Add a private `warpTargetSeed: number | null` field consumed in the `warpTimer <= 0` block.
- `src/hooks/useSpaceScene.ts`
  - Move `sectorFor` into `lib/galaxy.ts` and import from there (also used by destination overlay).
  - Add `warpTo(seed: number)` to the `CockpitController` — same flow as `warp()` but passes the chosen seed and uses it for the destination name/sector.
  - Track visited seeds in localStorage via a small helper in `lib/galaxy.ts` (`markVisited`, `getVisited`) so the map can show solid vs hollow.
- `src/components/Minimap.tsx` — add a **GALAXY** button to the header that calls a new `onOpenGalaxy` prop.
- `src/routes/play.tsx` — keep `galaxyOpen` state. Pass `onOpenGalaxy` to `<Minimap>`. Render `<GalaxyMap open={galaxyOpen} currentSeed={hud.systemSeed} onJumpTo={controller.warpTo} onClose={...} />`. Add `M` keybinding to toggle.
- `src/components/CockpitHUD.tsx` — expose `systemSeed` on `HUDState` so `play.tsx` can pass it to the map.
- `src/components/KeyBindingsHUD.tsx` — add `M  GALAXY MAP` line.

## Data shape

```ts
// lib/galaxy.ts
export type GalaxyNode = {
  seed: number;          // absolute seed (jump target)
  name: string;          // e.g. "Vexor Prime"
  sector: string;        // "SECTOR 12-B3 / 47-A8"
  kind: "star" | "blue-giant" | "red-dwarf";
  x: number; y: number;  // -1..1, current system at (0,0)
  distanceJumps: number; // 1..N, used as "warp cost" hint
  visited: boolean;
};
```

Placement: golden-angle spiral seeded by `currentSeed` so the chart is stable while the pilot is in that system. Star kind is derived from `seed % 17` to match the existing distribution flavor.

## Out of scope
- No actual multi-jump pathfinding — every map jump is a single 3-second lightspeed transition (mechanically identical to today's J jump, just to an arbitrary seed).
- No persistent "explored galaxy" map across pilots — visited seeds are per-pilot via the existing pilot id namespace.
- No 3D galaxy view — the map is a flat radial SVG to stay readable and fast.
- No change to the existing `J` keybinding (still jumps to `currentSeed + 1`).
