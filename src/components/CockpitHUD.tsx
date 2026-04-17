import { Link } from "@tanstack/react-router";

export type HUDState = {
  velocity: number;
  thrust: number; // -1..1
  warpCharge: number; // 0..1
  isWarping: boolean;
  heading: { pitch: number; yaw: number };
  score: number;
  rank: string;
  objective: string;
  paused: boolean;
  scanning: { name: string; progress: number } | null;
  lastDiscovery: string | null;
  showHints: boolean;
};

export function CockpitHUD({ state, onResume }: { state: HUDState; onResume: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none font-display text-hud">
      {/* Cockpit frame: top + bottom dashboards + side struts via SVG */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="dashTop" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#000" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dashBot" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Top frame */}
        <path d="M0,0 L1000,0 L1000,80 Q500,180 0,80 Z" fill="url(#dashTop)" />
        {/* Bottom dashboard */}
        <path d="M0,600 L1000,600 L1000,420 Q500,320 0,420 Z" fill="url(#dashBot)" />
        {/* Window struts */}
        <path d="M0,0 Q60,300 0,600" fill="#000" opacity="0.85" />
        <path d="M1000,0 Q940,300 1000,600" fill="#000" opacity="0.85" />
        {/* Center pillar accent */}
        <line x1="500" y1="80" x2="500" y2="120" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" />
      </svg>

      {/* Crosshair / reticle */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="80" height="80" viewBox="0 0 80 80" className="text-hud opacity-60">
          <circle cx="40" cy="40" r="28" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="2 4" />
          <circle cx="40" cy="40" r="2" fill="currentColor" />
          <line x1="40" y1="8" x2="40" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="40" y1="60" x2="40" y2="72" stroke="currentColor" strokeWidth="1" />
          <line x1="8" y1="40" x2="20" y2="40" stroke="currentColor" strokeWidth="1" />
          <line x1="60" y1="40" x2="72" y2="40" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>

      {/* Top-left: status */}
      <div className="absolute left-6 top-6 hud-panel rounded-md px-4 py-3 text-xs">
        <div className="text-hud-dim">PILOT RANK</div>
        <div className="mt-1 text-base hud-glow">{state.rank}</div>
        <div className="mt-2 text-hud-dim">SCORE</div>
        <div className="text-base">{state.score.toLocaleString()}</div>
      </div>

      {/* Top-right: journal link */}
      <div className="pointer-events-auto absolute right-6 top-6 flex flex-col items-end gap-2">
        <Link
          to="/journal"
          className="hud-panel rounded-md px-3 py-2 text-xs tracking-widest text-hud hover:bg-hud hover:text-background"
        >
          JOURNAL
        </Link>
        <Link
          to="/"
          className="hud-panel rounded-md px-3 py-2 text-xs tracking-widest text-hud-dim hover:text-hud"
        >
          EXIT
        </Link>
      </div>

      {/* Top-center: objective */}
      <div className="absolute left-1/2 top-6 -translate-x-1/2 hud-panel rounded-md px-4 py-2 text-center text-xs">
        <div className="text-hud-dim">OBJECTIVE</div>
        <div className="mt-1 text-amber">{state.objective}</div>
      </div>

      {/* Bottom-left: velocity + thrust */}
      <div className="absolute bottom-6 left-6 hud-panel rounded-md px-4 py-3 text-xs" style={{ minWidth: 220 }}>
        <div className="flex items-baseline justify-between">
          <span className="text-hud-dim">VELOCITY</span>
          <span className="text-2xl hud-glow">{state.velocity.toFixed(1)}</span>
        </div>
        <div className="mt-1 text-right text-[10px] text-hud-dim">u/s</div>
        <div className="mt-3 text-hud-dim">THRUST</div>
        <div className="relative mt-1 h-2 w-full rounded bg-hud/10">
          <div className="absolute left-1/2 top-0 h-full w-px bg-hud/40" />
          <div
            className="absolute top-0 h-full bg-hud"
            style={{
              left: state.thrust >= 0 ? "50%" : `${50 + state.thrust * 50}%`,
              width: `${Math.abs(state.thrust) * 50}%`,
            }}
          />
        </div>
      </div>

      {/* Bottom-right: warp drive */}
      <div className="absolute bottom-6 right-6 hud-panel rounded-md px-4 py-3 text-xs" style={{ minWidth: 220 }}>
        <div className="flex items-baseline justify-between">
          <span className="text-hud-dim">WARP DRIVE</span>
          <span className={state.warpCharge >= 1 ? "text-amber scan-pulse" : "text-hud"}>
            {state.warpCharge >= 1 ? "READY" : `${Math.floor(state.warpCharge * 100)}%`}
          </span>
        </div>
        <div className="mt-2 h-2 w-full rounded bg-hud/10">
          <div
            className={state.warpCharge >= 1 ? "h-full rounded bg-amber" : "h-full rounded bg-hud"}
            style={{ width: `${state.warpCharge * 100}%` }}
          />
        </div>
        <div className="mt-2 text-[10px] text-hud-dim">[SPACE] to engage</div>
      </div>

      {/* Bottom-center: artificial horizon */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 hud-panel rounded-full p-3">
        <svg width="80" height="80" viewBox="-50 -50 100 100" className="text-hud">
          <circle r="40" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
          <g transform={`rotate(${(state.heading.yaw * 180) / Math.PI})`}>
            <line x1="0" y1="-40" x2="0" y2="-30" stroke="currentColor" strokeWidth="2" />
          </g>
          <g transform={`translate(0, ${Math.max(-30, Math.min(30, (state.heading.pitch * 180) / Math.PI))})`}>
            <line x1="-30" y1="0" x2="30" y2="0" stroke="currentColor" strokeWidth="1" />
          </g>
          <circle r="2" fill="currentColor" />
        </svg>
      </div>

      {/* Scanning indicator */}
      {state.scanning && (
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 hud-panel rounded-md px-6 py-3 text-center">
          <div className="text-xs text-hud-dim">SCANNING</div>
          <div className="mt-1 text-lg text-hud hud-glow">{state.scanning.name}</div>
          <div className="mt-2 h-1 w-48 rounded bg-hud/10">
            <div className="h-full rounded bg-hud" style={{ width: `${state.scanning.progress * 100}%` }} />
          </div>
        </div>
      )}

      {/* New discovery flash */}
      {state.lastDiscovery && (
        <div className="absolute right-6 top-1/3 hud-panel rounded-md px-4 py-3 text-right">
          <div className="text-xs text-amber">+ NEW DISCOVERY</div>
          <div className="font-display text-lg text-foreground">{state.lastDiscovery}</div>
        </div>
      )}

      {/* Warp overlay flash */}
      {state.isWarping && (
        <div className="absolute inset-0 flex items-center justify-center bg-hud/10">
          <div className="font-display text-6xl text-hud hud-glow scan-pulse">LIGHTSPEED</div>
        </div>
      )}

      {/* Hints */}
      {state.showHints && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-32 hud-panel rounded-md px-6 py-4 text-center text-xs">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-hud-dim">
            <span>MOUSE</span><span className="text-foreground">Steer</span>
            <span>W / ↑</span><span className="text-foreground">Thrust forward</span>
            <span>S / ↓</span><span className="text-foreground">Reverse</span>
            <span>A D / ← →</span><span className="text-foreground">Roll</span>
            <span>SHIFT</span><span className="text-foreground">Boost</span>
            <span>SPACE</span><span className="text-foreground">Lightspeed jump</span>
            <span>ESC</span><span className="text-foreground">Pause</span>
          </div>
          <div className="mt-2 text-[10px] text-amber">Move mouse or press a key to begin</div>
        </div>
      )}

      {/* Pause overlay */}
      {state.paused && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="hud-panel rounded-lg p-8 text-center">
            <div className="font-display text-3xl text-hud hud-glow">PAUSED</div>
            <button
              onClick={onResume}
              className="mt-6 rounded-md border border-hud bg-hud/10 px-6 py-2 font-display text-sm tracking-widest text-hud hover:bg-hud hover:text-background"
            >
              RESUME
            </button>
            <div className="mt-4">
              <Link to="/" className="text-xs text-hud-dim hover:text-hud">Return to main menu</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
