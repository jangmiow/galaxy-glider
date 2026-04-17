export type Discovery = {
  id: string;
  name: string;
  type: "planet" | "ringed-planet" | "star" | "blue-giant" | "red-dwarf";
  size: number;
  color: string;
  distance: number;
  discoveredAt: number;
};

const KEY = "cosmic-drift:journal";

export function loadJournal(): Discovery[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Discovery[]) : [];
  } catch {
    return [];
  }
}

export function saveDiscovery(d: Discovery): Discovery[] {
  const list = loadJournal();
  if (list.some((x) => x.id === d.id)) return list;
  const next = [d, ...list].slice(0, 200);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function clearJournal() {
  localStorage.removeItem(KEY);
}

const PREFIXES = ["Kepler", "Nyx", "Vega", "Orion", "Lyra", "Cygnus", "Helios", "Astra", "Zenith", "Nova", "Eos", "Pyxis"];
const SUFFIXES = ["Prime", "VX", "IX", "Major", "Minor", "Reach", "Drift", "Gate", "Hollow", "Veil"];
export function generateName(seed: number): string {
  const p = PREFIXES[Math.floor(Math.abs(Math.sin(seed) * 9999)) % PREFIXES.length];
  const s = SUFFIXES[Math.floor(Math.abs(Math.cos(seed) * 9999)) % SUFFIXES.length];
  const n = Math.floor(Math.abs(Math.sin(seed * 1.7) * 99));
  return `${p}-${s} ${n}`;
}
