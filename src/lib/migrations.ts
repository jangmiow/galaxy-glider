/**
 * Versioned localStorage migrations.
 *
 * We persist a small integer schema version under `cosmic-drift:schema` and
 * advance it through a chain of pure migration steps on first access from
 * each client. Each step is responsible for upgrading every affected key
 * from version `n` to `n + 1` — adding default values, renaming keys,
 * splitting/merging shapes, etc. Steps run in order, exactly once, and the
 * resulting version is written back atomically at the end.
 *
 * To add a new persisted field:
 *   1. Bump `CURRENT_SCHEMA_VERSION` by 1.
 *   2. Append a step to `MIGRATIONS` that walks any existing keys and fills
 *      in the new field with a sensible default.
 *   3. Update the load/save functions to read/write the new field.
 *
 * Guarantees:
 *   - SSR-safe: no-op when `window` is undefined.
 *   - Idempotent: re-running on an already-current store does nothing.
 *   - Resilient: a single bad JSON value can't block the whole migration —
 *     individual key parses are wrapped in try/catch and skipped on failure.
 */

const SCHEMA_KEY = "cosmic-drift:schema";

/** Bump this whenever you add a migration step below. */
export const CURRENT_SCHEMA_VERSION = 2;

type MigrationStep = {
  /** Version this step upgrades FROM (i.e. produces version `from + 1`). */
  from: number;
  /** Short description for debug logging. */
  description: string;
  run: () => void;
};

// Helpers shared by steps ────────────────────────────────────────────────────

function eachKey(predicate: (key: string) => boolean, fn: (key: string) => void) {
  // Snapshot keys first because mutations during iteration shift indices.
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && predicate(k)) keys.push(k);
  }
  for (const k of keys) fn(k);
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or serialization failure — leave the existing value in place. */
  }
}

// Migration chain ────────────────────────────────────────────────────────────

const MIGRATIONS: MigrationStep[] = [
  {
    // v0 → v1: pre-versioned stores. Backfill `medals: []` on stats blobs that
    // were written before that field existed, and ensure pilots have a
    // `createdAt` (older rows might be missing it after manual edits).
    from: 0,
    description: "Backfill PilotStats.medals + Pilot.createdAt",
    run: () => {
      eachKey(
        (k) => k.startsWith("cosmic-drift:p:") && k.endsWith(":stats"),
        (k) => {
          const stats = readJSON<{ score?: number; rank?: string; medals?: string[] }>(k);
          if (!stats) return;
          if (!Array.isArray(stats.medals)) {
            writeJSON(k, { score: stats.score ?? 0, rank: stats.rank ?? "CADET", medals: [] });
          }
        },
      );
      const pilots = readJSON<Array<{ id: string; callsign: string; createdAt?: number }>>(
        "cosmic-drift:pilots",
      );
      if (Array.isArray(pilots)) {
        let mutated = false;
        const upgraded = pilots.map((p) => {
          if (typeof p.createdAt === "number") return p;
          mutated = true;
          return { ...p, createdAt: Date.now() };
        });
        if (mutated) writeJSON("cosmic-drift:pilots", upgraded);
      }
    },
  },
  {
    // v1 → v2: ensure every pilot has a `system-seed` entry so the resume-flow
    // doesn't have to special-case "missing key" vs "explicit Sol (0)".
    from: 1,
    description: "Initialize per-pilot system-seed default",
    run: () => {
      const pilots = readJSON<Array<{ id: string }>>("cosmic-drift:pilots") ?? [];
      for (const p of pilots) {
        const k = `cosmic-drift:p:${p.id}:system-seed`;
        if (localStorage.getItem(k) === null) localStorage.setItem(k, "0");
      }
    },
  },
];

// Runner ─────────────────────────────────────────────────────────────────────

let hasRun = false;

/**
 * Apply any pending migrations. Safe to call from any module-load path; the
 * first call performs the work, subsequent calls are no-ops within the same
 * page session. SSR-safe.
 */
export function runMigrations(): void {
  if (hasRun) return;
  if (typeof window === "undefined") return;
  hasRun = true;

  let current = 0;
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    if (raw !== null) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0) current = n;
    } else {
      // Fresh install (no schema key) AND no pilot data: skip straight to
      // current. Otherwise treat as v0 and run the upgrade chain so any
      // legacy pre-versioned data gets normalized.
      const hasLegacyData = localStorage.getItem("cosmic-drift:pilots") !== null;
      if (!hasLegacyData) {
        localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA_VERSION));
        return;
      }
    }
  } catch {
    // localStorage access blocked (private mode, disabled, etc.) — bail.
    return;
  }

  if (current >= CURRENT_SCHEMA_VERSION) return;

  for (const step of MIGRATIONS) {
    if (step.from < current) continue;
    if (step.from >= CURRENT_SCHEMA_VERSION) break;
    try {
      step.run();
      current = step.from + 1;
      localStorage.setItem(SCHEMA_KEY, String(current));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[migrations] step "${step.description}" failed:`, err);
      // Stop the chain — leaving the version pinned at the last successful
      // step means a future page load will retry from the same point.
      return;
    }
  }
}

/** Test/debug helper: reset the in-memory "already ran" guard. */
export function __resetMigrationsForTests(): void {
  hasRun = false;
}
