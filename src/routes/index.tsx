import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  UNLOCK_CODE,
  createPilot,
  deletePilot,
  isUnlocked,
  loadPilots,
  loadStats,
  setActivePilotId,
  setUnlocked,
  type Pilot,
} from "@/lib/pilots";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cosmic Drift — Pilot a starship through the galaxy" },
      { name: "description", content: "A cinematic first-person space exploration game. Thrust through nebulae, jump to lightspeed, and discover new worlds." },
      { property: "og:title", content: "Cosmic Drift" },
      { property: "og:description", content: "Pilot a starship through a procedurally generated galaxy." },
    ],
  }),
  component: Home,
});

function Home() {
  const [unlocked, setUnlockedState] = useState(false);
  // Track hydration so we don't render the unlocked UI during SSR (when
  // localStorage is unavailable) and then flicker back to locked on the
  // client. Until hydrated we render a neutral shell.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setUnlockedState(isUnlocked());
    setHydrated(true);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 animated-stars opacity-70" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/10 to-background" aria-hidden />
      <div
        className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--hud), transparent 60%)" }}
        aria-hidden
      />
      <div
        className="absolute -bottom-40 -left-40 h-[600px] w-[600px] rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--amber), transparent 60%)" }}
        aria-hidden
      />

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 text-xs uppercase tracking-[0.4em] text-hud-dim">A first-person space explorer</p>
        <h1 className="font-display text-6xl font-black tracking-[0.15em] text-hud hud-glow md:text-8xl">
          COSMIC DRIFT
        </h1>

        {!hydrated ? (
          <div className="mt-10 h-32" aria-hidden />
        ) : !unlocked ? (
          <UnlockGate onUnlock={() => setUnlockedState(true)} />
        ) : (
          <PilotHub onLock={() => { setUnlocked(false); setUnlockedState(false); }} />
        )}

        <p className="mt-12 text-xs text-muted-foreground">
          Best experienced on desktop with sound on.
        </p>
      </main>
    </div>
  );
}

/**
 * Soft access gate. Asks for the shared 4-digit code; on a correct entry we
 * persist the unlock so the prompt doesn't reappear every visit. Wrong codes
 * shake the input and clear it. Not a security boundary — purely to keep
 * casual snoopers from picking a profile that isn't theirs.
 */
function UnlockGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === UNLOCK_CODE) {
      setUnlocked(true);
      onUnlock();
    } else {
      setError(true);
      setCode("");
      setTimeout(() => setError(false), 600);
    }
  };

  return (
    <form onSubmit={submit} className="mt-10 flex flex-col items-center gap-4">
      <p className="max-w-sm text-sm text-muted-foreground">
        Enter the flight-deck access code to view pilot profiles.
      </p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="• • • •"
        className={`hud-panel w-48 rounded-md px-4 py-3 text-center font-display text-2xl tracking-[0.4em] text-hud outline-none ${
          error ? "animate-pulse border-amber" : ""
        }`}
        aria-label="Access code"
      />
      <button
        type="submit"
        className="rounded-md border border-hud bg-hud/10 px-6 py-2 font-display text-xs tracking-widest text-hud transition-all hover:bg-hud hover:text-background"
      >
        UNLOCK
      </button>
      {error && (
        <p className="text-xs text-amber" role="alert">Access denied — wrong code.</p>
      )}
    </form>
  );
}

/**
 * Profile picker + leaderboard. Players pick a card to set the active pilot
 * then launch the flight. New pilots are created via a small inline form;
 * existing pilots can be deleted (with a confirm) to free a slot.
 */
function PilotHub({ onLock }: { onLock: () => void }) {
  const navigate = useNavigate();
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [showNew, setShowNew] = useState(false);

  const refresh = () => setPilots(loadPilots());
  useEffect(() => { refresh(); }, []);

  // Auto-dive: if exactly one pilot exists and the creation form is closed,
  // skip the picker entirely and launch them straight into /play. Keeps the
  // single-user case (e.g. just LOTUS) friction-free while still showing the
  // hub the moment a second pilot is added.
  useEffect(() => {
    if (showNew) return;
    if (pilots.length !== 1) return;
    const only = pilots[0];
    setActivePilotId(only.id);
    navigate({ to: "/play" });
  }, [pilots, showNew, navigate]);

  // Sort by score desc for the leaderboard ordering.
  const ranked = useMemo(() => {
    return pilots
      .map((p) => ({ pilot: p, stats: loadStats(p.id) }))
      .sort((a, b) => b.stats.score - a.stats.score || a.pilot.createdAt - b.pilot.createdAt);
  }, [pilots]);

  const choose = (p: Pilot) => {
    setActivePilotId(p.id);
    navigate({ to: "/play" });
  };

  const handleDelete = (p: Pilot) => {
    if (!confirm(`Delete pilot ${p.callsign}? This wipes their journal, score, and medals.`)) return;
    deletePilot(p.id);
    refresh();
  };

  return (
    <div className="mt-10 w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between text-xs">
        <span className="tracking-[0.3em] text-hud-dim">SELECT PILOT</span>
        <button
          onClick={onLock}
          className="text-hud-dim transition-colors hover:text-hud"
          aria-label="Lock the flight deck"
        >
          ⌂ LOCK
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ranked.map(({ pilot, stats }, i) => (
          <PilotCard
            key={pilot.id}
            pilot={pilot}
            stats={stats}
            rank={i + 1}
            total={ranked.length}
            onChoose={() => choose(pilot)}
            onDelete={() => handleDelete(pilot)}
          />
        ))}
        {ranked.length < 4 && (
          <button
            onClick={() => setShowNew(true)}
            className="hud-panel flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border-dashed text-hud-dim transition-colors hover:border-hud hover:text-hud"
          >
            <span className="font-display text-3xl">+</span>
            <span className="text-xs tracking-widest">ADD PILOT</span>
          </button>
        )}
      </div>

      {showNew && <NewPilotForm onCreate={(callsign) => { createPilot(callsign); setShowNew(false); refresh(); }} onCancel={() => setShowNew(false)} />}

      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          to="/journal"
          className="inline-flex items-center justify-center rounded-md border border-border bg-transparent px-6 py-2 font-display text-xs tracking-widest text-foreground transition-colors hover:border-hud hover:text-hud"
        >
          DISCOVERY JOURNAL
        </Link>
      </div>
    </div>
  );
}

function PilotCard({
  pilot,
  stats,
  rank,
  total,
  onChoose,
  onDelete,
}: {
  pilot: Pilot;
  stats: { score: number; rank: string; medals: string[] };
  rank: number;
  total: number;
  onChoose: () => void;
  onDelete: () => void;
}) {
  const isLeader = total > 1 && rank === 1 && stats.score > 0;
  return (
    <div className="hud-panel relative rounded-md p-4 text-left">
      {isLeader && (
        <span
          className="absolute right-3 top-3 text-lg"
          title="Top pilot"
          aria-label="Top pilot"
        >
          🥇
        </span>
      )}
      <button
        onClick={onChoose}
        className="block w-full text-left outline-none"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-2xl tracking-wider text-hud hud-glow">{pilot.callsign}</span>
          <span className="text-[10px] tracking-widest text-hud-dim">#{rank}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-hud-dim">RANK</div>
            <div className="text-foreground">{stats.rank}</div>
          </div>
          <div>
            <div className="text-hud-dim">SCORE</div>
            <div className="text-foreground">{stats.score.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-hud-dim">MEDALS</div>
            <div className="text-amber">{stats.medals.length}</div>
          </div>
        </div>
        <div className="mt-3 text-[10px] tracking-widest text-hud">▶ LAUNCH</div>
      </button>
      <button
        onClick={onDelete}
        className="absolute bottom-2 right-3 text-[10px] text-hud-dim/70 transition-colors hover:text-amber"
        aria-label={`Delete ${pilot.callsign}`}
      >
        delete
      </button>
    </div>
  );
}

function NewPilotForm({ onCreate, onCancel }: { onCreate: (callsign: string) => void; onCancel: () => void }) {
  const [callsign, setCallsign] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(callsign);
  };
  return (
    <form onSubmit={submit} className="mt-4 hud-panel rounded-md p-4 text-left">
      <label className="block text-xs tracking-widest text-hud-dim">CALLSIGN</label>
      <div className="mt-2 flex gap-2">
        <input
          autoFocus
          maxLength={16}
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder="e.g. NOVA"
          className="hud-panel flex-1 rounded-md px-3 py-2 font-display tracking-widest text-hud outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-hud bg-hud/10 px-4 py-2 font-display text-xs tracking-widest text-hud hover:bg-hud hover:text-background"
        >
          CREATE
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 font-display text-xs tracking-widest text-hud-dim hover:text-hud"
        >
          CANCEL
        </button>
      </div>
    </form>
  );
}
