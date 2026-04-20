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
            <stop offset="60%" stopColor="#0a1118" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dashBot" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.98" />
            <stop offset="55%" stopColor="#0d1620" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="strutL" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#0c1620" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="strutR" x1="1" x2="0" y1="0" y2="0">
            <stop offset="0%" stopColor="#000" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#0c1620" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="consoleGlow" cx="0.5" cy="1" r="0.7">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
            <stop offset="60%" stopColor="#0891b2" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Top frame */}
        <path d="M0,0 L1000,0 L1000,90 Q500,200 0,90 Z" fill="url(#dashTop)" />
        {/* Bottom dashboard with subtle console glow */}
        <path d="M0,600 L1000,600 L1000,400 Q500,290 0,400 Z" fill="url(#dashBot)" />
        <ellipse cx="500" cy="600" rx="420" ry="160" fill="url(#consoleGlow)" />
        {/* Window struts (curved interior pillars) */}
        <path d="M0,0 Q90,300 0,600 L0,0 Z" fill="url(#strutL)" />
        <path d="M1000,0 Q910,300 1000,600 L1000,0 Z" fill="url(#strutR)" />
        {/* Strut highlights — thin cyan rim suggests interior reflections */}
        <path d="M0,0 Q90,300 0,600" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1" fill="none" />
        <path d="M1000,0 Q910,300 1000,600" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1" fill="none" />
        {/* Top canopy seam */}
        <path d="M0,90 Q500,200 1000,90" stroke="#22d3ee" strokeOpacity="0.18" strokeWidth="1" fill="none" />
        {/* Dashboard seam + panel lines (subtle interior detail) */}
        <path d="M0,400 Q500,290 1000,400" stroke="#22d3ee" strokeOpacity="0.22" strokeWidth="1" fill="none" />
        <path d="M180,470 L820,470" stroke="#22d3ee" strokeOpacity="0.12" strokeWidth="1" />
        <path d="M260,510 L740,510" stroke="#22d3ee" strokeOpacity="0.08" strokeWidth="1" />
        {/* Tiny dashboard indicator dots */}
        <circle cx="220" cy="540" r="2" fill="#22d3ee" opacity="0.6" />
        <circle cx="240" cy="540" r="2" fill="#fbbf24" opacity="0.5" />
        <circle cx="780" cy="540" r="2" fill="#22d3ee" opacity="0.6" />
        <circle cx="760" cy="540" r="2" fill="#f87171" opacity="0.5" />
        {/* Center pillar accent */}
        <line x1="500" y1="90" x2="500" y2="140" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" />
      </svg>

      {/* Crosshair / lock-on reticle. Idle: subtle dashed ring + tick marks.
          Scanning: corner brackets light up amber, a circular progress ring
          fills clockwise around the center, and the target name appears below. */}
      <LockOnReticle scanning={state.scanning} />

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

      {/* Scanning state is shown in the central LockOnReticle above; no
          duplicate panel needed here. */}

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

/**
 * Centered cockpit reticle. When `scanning` is null we render the idle
 * crosshair; when a target is being scanned we light up corner brackets,
 * draw a circular progress ring (clockwise fill via stroke-dashoffset),
 * and label the target underneath.
 */
function LockOnReticle({ scanning }: { scanning: HUDState["scanning"] }) {
  const active = scanning != null;
  const progress = scanning?.progress ?? 0;
  // Ring geometry — circumference drives the dashoffset for a clockwise fill.
  const R = 36;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - progress);
  const locked = progress >= 0.999;

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg
        width="100"
        height="100"
        viewBox="0 0 100 100"
        className={active ? "text-amber" : "text-hud opacity-60"}
      >
        {/* Idle dashed ring (always present, dims when active) */}
        <circle
          cx="50"
          cy="50"
          r="28"
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
          strokeDasharray="2 4"
          opacity={active ? 0.25 : 1}
        />
        {/* Center dot */}
        <circle cx="50" cy="50" r="2" fill="currentColor" />
        {/* Idle crosshair tick marks */}
        <line x1="50" y1="14" x2="50" y2="22" stroke="currentColor" strokeWidth="1" />
        <line x1="50" y1="78" x2="50" y2="86" stroke="currentColor" strokeWidth="1" />
        <line x1="14" y1="50" x2="22" y2="50" stroke="currentColor" strokeWidth="1" />
        <line x1="78" y1="50" x2="86" y2="50" stroke="currentColor" strokeWidth="1" />

        {active && (
          <>
            {/* Progress track */}
            <circle
              cx="50"
              cy="50"
              r={R}
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="2"
              fill="none"
            />
            {/* Progress ring — rotate -90deg so it starts at 12 o'clock */}
            <circle
              cx="50"
              cy="50"
              r={R}
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 80ms linear" }}
            />
            {/* Corner lock brackets */}
            {[
              "M14,26 L14,14 L26,14",
              "M74,14 L86,14 L86,26",
              "M86,74 L86,86 L74,86",
              "M26,86 L14,86 L14,74",
            ].map((d) => (
              <path key={d} d={d} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            ))}
          </>
        )}
      </svg>
      {active && (
        <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center">
          <div className="text-[10px] tracking-widest text-hud-dim">
            {locked ? "LOCKED" : "SCANNING"}
          </div>
          <div
            className={`text-sm tracking-wider ${locked ? "text-amber hud-glow scan-pulse" : "text-amber"}`}
          >
            {scanning?.name}
          </div>
        </div>
      )}
    </div>
  );
}
