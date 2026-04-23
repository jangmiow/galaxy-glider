/**
 * Pilot profiles. A small, fully client-side multi-user system: the home
 * route is gated behind a 4-digit code, then the player picks a pilot. Each
 * pilot has their own discovery journal, score, rank, and surveyed-system
 * medals — all stored in localStorage under a pilot-scoped key prefix.
 *
 * No backend / auth. Designed for a household-sized roster (you + your
 * boyfriend, maybe a guest) sharing one device. The unlock code is a soft
 * gate to keep curious siblings or kids out of the save data, not a security
 * boundary.
 */

import { runMigrations } from "./migrations";

export const UNLOCK_CODE = "0811";

export type Pilot = {
  id: string;
  callsign: string;
  /** ISO timestamp of profile creation, used as a stable secondary sort. */
  createdAt: number;
};

const PILOTS_KEY = "cosmic-drift:pilots";
const ACTIVE_KEY = "cosmic-drift:active-pilot";
const UNLOCK_KEY = "cosmic-drift:unlocked";

/** Per-pilot localStorage key for any pilot-scoped data (journal, score, …). */
export function pilotKey(pilotId: string, suffix: string): string {
  return `cosmic-drift:p:${pilotId}:${suffix}`;
}

// ── Pilot roster ────────────────────────────────────────────────────────────

export function loadPilots(): Pilot[] {
  if (typeof window === "undefined") return [];
  runMigrations();
  try {
    const raw = localStorage.getItem(PILOTS_KEY);
    return raw ? (JSON.parse(raw) as Pilot[]) : [];
  } catch {
    return [];
  }
}

export function savePilots(pilots: Pilot[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PILOTS_KEY, JSON.stringify(pilots));
}

export function createPilot(callsign: string): Pilot {
  const trimmed = callsign.trim().slice(0, 16) || "PILOT";
  const pilot: Pilot = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    callsign: trimmed.toUpperCase(),
    createdAt: Date.now(),
  };
  const pilots = loadPilots();
  pilots.push(pilot);
  savePilots(pilots);
  return pilot;
}

export function deletePilot(pilotId: string): void {
  if (typeof window === "undefined") return;
  savePilots(loadPilots().filter((p) => p.id !== pilotId));
  // Sweep all per-pilot storage keys for this pilot.
  const prefix = `cosmic-drift:p:${pilotId}:`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) localStorage.removeItem(k);
  }
  if (getActivePilotId() === pilotId) localStorage.removeItem(ACTIVE_KEY);
}

// ── Active pilot ────────────────────────────────────────────────────────────

export function getActivePilotId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActivePilotId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id == null) localStorage.removeItem(ACTIVE_KEY);
  else localStorage.setItem(ACTIVE_KEY, id);
}

export function getActivePilot(): Pilot | null {
  const id = getActivePilotId();
  if (!id) return null;
  return loadPilots().find((p) => p.id === id) ?? null;
}

// ── Unlock gate ─────────────────────────────────────────────────────────────

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(UNLOCK_KEY) === "1";
}

export function setUnlocked(v: boolean): void {
  if (typeof window === "undefined") return;
  if (v) localStorage.setItem(UNLOCK_KEY, "1");
  else localStorage.removeItem(UNLOCK_KEY);
}

// ── Per-pilot stats (score, rank, medals) ───────────────────────────────────

export type PilotStats = {
  score: number;
  rank: string;
  /** System ids the pilot has fully surveyed (for medal display). */
  medals: string[];
};

const EMPTY_STATS: PilotStats = { score: 0, rank: "CADET", medals: [] };

export function loadStats(pilotId: string): PilotStats {
  if (typeof window === "undefined") return { ...EMPTY_STATS };
  try {
    const raw = localStorage.getItem(pilotKey(pilotId, "stats"));
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw) as Partial<PilotStats>;
    return {
      score: parsed.score ?? 0,
      rank: parsed.rank ?? "CADET",
      medals: parsed.medals ?? [],
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function saveStats(pilotId: string, stats: PilotStats): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(pilotKey(pilotId, "stats"), JSON.stringify(stats));
}

export function addMedal(pilotId: string, systemId: string): PilotStats {
  const stats = loadStats(pilotId);
  if (!stats.medals.includes(systemId)) stats.medals.push(systemId);
  saveStats(pilotId, stats);
  return stats;
}

// ── Per-pilot world state (current galaxy/system seed) ──────────────────────

/**
 * The seed of the procedurally generated system the pilot was last in. 0 is
 * the hand-authored Sol system shown on a fresh game; any positive integer
 * maps deterministically to a generated star system via SpaceScene.buildSystem.
 * Persisting this lets reloading /play resume the same environment instead of
 * re-spawning the pilot in Sol every time.
 */
export function loadSystemSeed(pilotId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(pilotKey(pilotId, "system-seed"));
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveSystemSeed(pilotId: string, seed: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(pilotKey(pilotId, "system-seed"), String(seed));
}

// ── Per-pilot flight state (auto-save / resume) ─────────────────────────────

/**
 * Snapshot of where the pilot's ship was when they last left /play. Restored
 * on the next mount so the cockpit picks up exactly where it left off:
 * same system, same position, same heading, same forward velocity.
 *
 * Stored under `cosmic-drift:p:{id}:flight`. Updated by the scene loop at
 * ~3s cadence (or on big position deltas), on pause, and on tab unload.
 */
export type PilotFlightState = {
  systemSeed: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  velocity: number;
  savedAt: number;
};

export function loadFlightState(pilotId: string): PilotFlightState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(pilotKey(pilotId, "flight"));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PilotFlightState>;
    if (
      typeof parsed.systemSeed !== "number" ||
      !Array.isArray(parsed.pos) || parsed.pos.length !== 3 ||
      !Array.isArray(parsed.quat) || parsed.quat.length !== 4
    ) return null;
    return {
      systemSeed: parsed.systemSeed,
      pos: parsed.pos as [number, number, number],
      quat: parsed.quat as [number, number, number, number],
      velocity: parsed.velocity ?? 0,
      savedAt: parsed.savedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveFlightState(pilotId: string, state: PilotFlightState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(pilotKey(pilotId, "flight"), JSON.stringify(state));
  } catch {
    // Quota / serialisation errors are non-fatal — autosave silently skips.
  }
}
