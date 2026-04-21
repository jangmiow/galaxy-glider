import { getActivePilotId, pilotKey } from "./pilots";

export type Discovery = {
  id: string;
  name: string;
  type: "planet" | "ringed-planet" | "moon" | "star" | "blue-giant" | "red-dwarf";
  size: number;
  color: string;
  distance: number;
  discoveredAt: number;
};

/**
 * Journal storage is scoped per-pilot via the active pilot id from
 * `lib/pilots`. If no pilot is active we fall back to a shared "guest" key
 * so the game still functions (e.g. opening /play without picking a pilot
 * doesn't crash).
 */
function journalKey(): string {
  const id = getActivePilotId();
  return id ? pilotKey(id, "journal") : "cosmic-drift:journal:guest";
}

export function loadJournal(): Discovery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(journalKey());
    return raw ? (JSON.parse(raw) as Discovery[]) : [];
  } catch {
    return [];
  }
}

export function saveDiscovery(d: Discovery): Discovery[] {
  const list = loadJournal();
  if (list.some((x) => x.id === d.id)) return list;
  const next = [d, ...list].slice(0, 200);
  if (typeof window === "undefined") return next;
  localStorage.setItem(journalKey(), JSON.stringify(next));
  return next;
}

export function clearJournal() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(journalKey());
}

const PREFIXES = ["Kepler", "Nyx", "Vega", "Orion", "Lyra", "Cygnus", "Helios", "Astra", "Zenith", "Nova", "Eos", "Pyxis"];
const SUFFIXES = ["Prime", "VX", "IX", "Major", "Minor", "Reach", "Drift", "Gate", "Hollow", "Veil"];
export function generateName(seed: number): string {
  const p = PREFIXES[Math.floor(Math.abs(Math.sin(seed) * 9999)) % PREFIXES.length];
  const s = SUFFIXES[Math.floor(Math.abs(Math.cos(seed) * 9999)) % SUFFIXES.length];
  const n = Math.floor(Math.abs(Math.sin(seed * 1.7) * 99));
  return `${p}-${s} ${n}`;
}
