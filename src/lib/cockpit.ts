/**
 * Pure cockpit constants + helpers shared across the play route, the scene
 * hook, and any future debug tooling. Keeping these out of the route file
 * makes them trivially testable and importable from sub-components.
 */
import type { Discovery } from "@/lib/journal";

export const OBJECTIVES = [
  "Discover 3 new worlds",
  "Reach a blue giant star",
  "Collect 5 energy orbs",
  "Engage lightspeed",
  "Discover a ringed planet",
];

/**
 * Maps a human objective string to the body kind the minimap should highlight.
 * `null` means "no specific target" (e.g. lightspeed). `"orb"` is a special
 * marker the minimap understands.
 */
export const OBJECTIVE_TARGET: Record<string, Discovery["type"] | "orb" | null> = {
  "Discover 3 new worlds": "planet",
  "Reach a blue giant star": "blue-giant",
  "Collect 5 energy orbs": "orb",
  "Engage lightspeed": null,
  "Discover a ringed planet": "ringed-planet",
};

/** Discrete minimap zoom steps in scene units. */
export const RANGE_STEPS = [200, 400, 800, 1600, 3200] as const;
export const DEFAULT_RANGE = 800;

/** Pilot rank thresholds. */
export function rankFor(score: number): string {
  if (score >= 5000) return "COMMANDER";
  if (score >= 2500) return "CAPTAIN";
  if (score >= 1000) return "PILOT";
  if (score >= 250) return "ENSIGN";
  return "CADET";
}
