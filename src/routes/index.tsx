import { createFileRoute, Link } from "@tanstack/react-router";

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
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Animated star backdrop */}
      <div className="absolute inset-0 animated-stars opacity-70" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/10 to-background" aria-hidden />
      {/* Distant nebula glow */}
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
        <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
          Take the helm of a deep-space cruiser. Thrust through the void, dodge nebulae,
          jump to lightspeed, and chart unknown worlds in a galaxy that never ends.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/play"
            className="group relative inline-flex items-center justify-center overflow-hidden rounded-md border border-hud bg-hud/10 px-8 py-3 font-display text-sm tracking-widest text-hud transition-all hover:bg-hud hover:text-background hud-glow"
          >
            ▶ LAUNCH FLIGHT
          </Link>
          <Link
            to="/journal"
            className="inline-flex items-center justify-center rounded-md border border-border bg-transparent px-8 py-3 font-display text-sm tracking-widest text-foreground transition-colors hover:border-hud hover:text-hud"
          >
            DISCOVERY JOURNAL
          </Link>
        </div>

        <section className="mt-16 grid max-w-3xl gap-4 sm:grid-cols-3">
          {[
            { k: "Mouse", v: "Pitch & Yaw" },
            { k: "W / S", v: "Thrust" },
            { k: "Space", v: "Lightspeed" },
          ].map((c) => (
            <div key={c.k} className="hud-panel rounded-md p-4 text-left">
              <div className="font-display text-xs uppercase tracking-widest text-hud-dim">{c.k}</div>
              <div className="mt-1 font-display text-sm text-foreground">{c.v}</div>
            </div>
          ))}
        </section>

        <p className="mt-12 text-xs text-muted-foreground">
          Best experienced on desktop with sound on.
        </p>
      </main>
    </div>
  );
}
