// Pure helpers for the Galaxy Map: deterministic node placement, sector codes,
// and per-pilot "visited systems" tracking in localStorage.

import { generateName } from "@/lib/journal";

export type GalaxyKind = "star" | "blue-giant" | "red-dwarf";

export type GalaxyNode = {
  /** Absolute system seed — pass this to `warpTo` to jump there. */
  seed: number;
  name: string;
  sector: string;
  kind: GalaxyKind;
  /** Normalized chart coordinates, -1..1, with current system at (0,0). */
  x: number;
  y: number;
  /** Hops from the current system (|seed - currentSeed|). */
  distanceJumps: number;
  visited: boolean;
};

/** Deterministic SECTOR coordinate string from a system seed. */
export function sectorFor(seed: number): string {
  const n = Math.abs(Math.floor(seed));
  const x = (n % 64).toString().padStart(2, "0");
  const yLetter = String.fromCharCode(65 + (Math.floor(n / 64) % 26));
  const y = (Math.floor(n / 7) % 10).toString();
  const z = (Math.floor(n / 13) % 64).toString().padStart(2, "0");
  const wLetter = String.fromCharCode(65 + (Math.floor(n / 211) % 26));
  const w = (Math.floor(n / 29) % 10).toString();
  return `SECTOR ${x}-${yLetter}${y} / ${z}-${wLetter}${w}`;
}

/** Cheap deterministic hash → 0..1 from any integer key. */
function hash01(k: number): number {
  let n = (k | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  n ^= n >>> 16;
  return ((n >>> 0) % 100000) / 100000;
}

function kindFor(seed: number): GalaxyKind {
  const m = Math.abs(seed) % 17;
  if (m === 0) return "blue-giant";
  if (m === 1 || m === 2) return "red-dwarf";
  return "star";
}

/** Generate a stable star chart of nearby systems around `currentSeed`.
 *  Uses a golden-angle spiral so nodes never overlap and the layout is
 *  deterministic per current seed. */
export function getNearbySystems(
  currentSeed: number,
  visited: Set<number>,
  count = 24,
): GalaxyNode[] {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const nodes: GalaxyNode[] = [];
  for (let i = 1; i <= count; i++) {
    // Mix neighbour seeds on both sides, weighted by hash so the chart isn't
    // a perfectly straight numerical sequence.
    const sign = hash01(currentSeed * 31 + i) > 0.5 ? 1 : -1;
    const offset = i;
    const seed = currentSeed + sign * offset;
    if (seed === currentSeed) continue;
    // Spiral placement: radius grows with sqrt(i) for even density.
    const radius = Math.min(0.95, 0.18 + Math.sqrt(i / count) * 0.78);
    const jitter = (hash01(seed * 7) - 0.5) * 0.06;
    const angle = i * GOLDEN + hash01(currentSeed) * Math.PI * 2;
    nodes.push({
      seed,
      name: generateName(seed * 1000),
      sector: sectorFor(seed),
      kind: kindFor(seed),
      x: Math.cos(angle) * (radius + jitter),
      y: Math.sin(angle) * (radius + jitter),
      distanceJumps: Math.abs(seed - currentSeed),
      visited: visited.has(seed),
    });
  }
  return nodes;
}

const VISITED_KEY = (pilotId: string) => `cosmic-drift:visited:${pilotId}`;

export function loadVisited(pilotId: string | null): Set<number> {
  if (!pilotId || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VISITED_KEY(pilotId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : []);
  } catch {
    return new Set();
  }
}

export function markVisited(pilotId: string | null, seed: number): void {
  if (!pilotId || typeof window === "undefined") return;
  const set = loadVisited(pilotId);
  if (set.has(seed)) return;
  set.add(seed);
  try {
    window.localStorage.setItem(VISITED_KEY(pilotId), JSON.stringify([...set]));
  } catch {
    // ignore quota errors
  }
}
