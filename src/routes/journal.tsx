import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clearJournal, loadJournal, type Discovery } from "@/lib/journal";

export const Route = createFileRoute("/journal")({
  head: () => ({
    meta: [
      { title: "Discovery Journal — Cosmic Drift" },
      { name: "description", content: "Your log of planets, stars, and worlds discovered while piloting through the galaxy." },
      { property: "og:title", content: "Discovery Journal — Cosmic Drift" },
      { property: "og:description", content: "Your log of discovered worlds." },
    ],
  }),
  component: Journal,
});

function Journal() {
  const [items, setItems] = useState<Discovery[]>([]);

  useEffect(() => {
    setItems(loadJournal());
  }, []);

  return (
    <div className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/" className="text-xs uppercase tracking-[0.3em] text-hud-dim hover:text-hud">
              ← Back to base
            </Link>
            <h1 className="mt-2 font-display text-4xl text-hud hud-glow">Discovery Journal</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} celestial {items.length === 1 ? "body" : "bodies"} cataloged
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/play"
              className="inline-flex items-center rounded-md border border-hud bg-hud/10 px-4 py-2 font-display text-xs tracking-widest text-hud hover:bg-hud hover:text-background"
            >
              CONTINUE FLIGHT
            </Link>
            {items.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Clear all discoveries?")) {
                    clearJournal();
                    setItems([]);
                  }
                }}
                className="inline-flex items-center rounded-md border border-border px-4 py-2 font-display text-xs tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive"
              >
                CLEAR
              </button>
            )}
          </div>
        </header>

        {items.length === 0 ? (
          <div className="hud-panel rounded-lg p-12 text-center">
            <p className="font-display text-lg text-hud-dim">No discoveries yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Launch a flight and fly close to a planet or star to scan it.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((d) => (
              <article key={d.id} className="hud-panel rounded-lg p-5">
                <div className="flex items-center gap-4">
                  <div
                    className="h-16 w-16 shrink-0 rounded-full"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${d.color}, #000 80%)`,
                      boxShadow: `0 0 24px ${d.color}55`,
                    }}
                  />
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-lg text-foreground">{d.name}</h3>
                    <p className="text-xs uppercase tracking-widest text-hud-dim">{d.type.replace("-", " ")}</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-hud-dim">Diameter</dt>
                    <dd className="font-display text-foreground">{(d.size * 1000).toFixed(0)} km</dd>
                  </div>
                  <div>
                    <dt className="text-hud-dim">Distance</dt>
                    <dd className="font-display text-foreground">{d.distance.toFixed(0)} AU</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
