import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export type HUDState = {
  velocity: number;
  thrust: number; // -1..1
  warpCharge: number; // 0..1
  isWarping: boolean;
  heading: { pitch: number; yaw: number };
  score: number;
  rank: string;
  /** Active pilot's display name. Falls back to "PILOT" if no profile is set. */
  callsign: string;
  objective: string;
  paused: boolean;
  scanning: { name: string; progress: number; alreadyScanned?: boolean } | null;
  lastDiscovery: string | null;
  showHints: boolean;
  /** Set when the pilot fully scans every body in a star system. Cleared after the celebration plays. */
  medal: { systemName: string; bodyCount: number } | null;
  /** True while SHIFT is held — drives the cockpit BOOST indicator. */
  boost: boolean;
  /** True while the 2s Space-tap burst is currently firing. */
  boostBurst: boolean;
  /** Remaining boost-burst cooldown in seconds (0 when ready to fire again). */
  boostCooldown: number;
  /** Total cooldown duration in seconds — used to render the ring fill. */
  boostCooldownMax: number;
  /** Total boost-burst duration in seconds — used to render the active ring drain. */
  boostDuration: number;
  /** Remaining time on the active boost burst (s). */
  boostRemaining: number;
  /** 0..1 progress of the hold-Space-to-warp gesture (1 = warp engages). */
  warpHoldProgress: number;
  /** Closeness (0..1) and atmosphere color of the nearest body, if any. */
  proximity: { closeness: number; color: string } | null;
  /** Approach autopilot status — name + live distance to current target. */
  approach: { target: string; distance: number } | null;
  /** Active F-key framing tween — drives the center-screen reticle that names the chosen body. */
  framing: { target: string; distance: number; progress: number } | null;
  /** Passive proximity meter to nearest uncatalogued body (signal 0..1, 1 = at ship). */
  sensorContact: { name: string; distance: number; signal: number } | null;
  /** Active flyby autopilot — target name + 0..1 progress along the curve. */
  flyby: { target: string; progress: number } | null;
  /** Tunable flyby parameters surfaced in the pause menu + tweaked via hotkeys. */
  flybyConfig: { altitudeMul: number; offsetMul: number; durationMul: number };
};

export function CockpitHUD({
  state,
  onResume,
  onFlybyConfigChange,
}: {
  state: HUDState;
  onResume: () => void;
  onFlybyConfigChange?: (cfg: Partial<{ altitudeMul: number; offsetMul: number; durationMul: number }>) => void;
}) {
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Backquote") setDebug((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none font-display text-hud">
      {debug && (
        <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded border border-hud/60 bg-black/80 px-3 py-1.5 text-[10px] leading-tight tracking-widest">
          <div className="text-hud/60">DEBUG · ` to toggle</div>
          <div>YAW   {state.heading.yaw.toFixed(3)} rad</div>
          <div>PITCH {state.heading.pitch.toFixed(3)} rad</div>
          <div>THRUST {state.thrust.toFixed(3)}</div>
          <div>VEL   {state.velocity.toFixed(2)}</div>
        </div>
      )}
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
      <LockOnReticle scanning={state.scanning} warpHoldProgress={state.warpHoldProgress} />

      {/* F-key framing reticle — appears while the cinematic tween is rotating
          the camera onto a chosen body. Shows the target name + live distance
          and a slim progress arc so the pilot knows when the swing completes. */}
      {state.framing && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-fade-in pointer-events-none">
          <div className="relative flex h-32 w-32 items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
              <circle cx="50" cy="50" r="46" fill="none" stroke="oklch(var(--hud) / 0.25)" strokeWidth="0.6" strokeDasharray="2 3" />
              <circle
                cx="50" cy="50" r="46" fill="none"
                stroke="oklch(var(--hud))" strokeWidth="1.4"
                strokeDasharray={`${state.framing.progress * 289} 289`}
                transform="rotate(-90 50 50)"
                strokeLinecap="round"
              />
              {/* Corner ticks */}
              {[0, 90, 180, 270].map((a) => (
                <line key={a} x1="50" y1="2" x2="50" y2="8" stroke="oklch(var(--hud))" strokeWidth="1.2" transform={`rotate(${a} 50 50)`} />
              ))}
            </svg>
          </div>
          <div className="mt-2 text-center text-[10px] tracking-widest">
            <div className="text-hud-dim">FRAMING</div>
            <div className="text-hud">{state.framing.target}</div>
            <div className="text-amber">{state.framing.distance.toFixed(0)}u</div>
          </div>
        </div>
      )}

      {/* Top-left: status */}
      <div className="absolute left-6 top-6 hud-panel rounded-md px-4 py-3 text-xs">
        <div className="text-hud-dim">PILOT</div>
        <div className="mt-1 font-display text-lg tracking-widest text-hud hud-glow">{state.callsign}</div>
        <div className="mt-2 text-hud-dim">RANK</div>
        <div className="text-sm">{state.rank}</div>
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

      {/* Approach autopilot status pill (just below the objective) */}
      {state.approach && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 hud-panel rounded-full border border-hud/60 bg-hud/10 px-3 py-1 text-center text-[10px] tracking-widest">
          <span className="text-hud-dim">APPROACH ·</span>{" "}
          <span className="text-hud">{state.approach.target}</span>{" "}
          <span className="text-hud-dim">·</span>{" "}
          <span className="text-amber">{state.approach.distance.toFixed(0)}u</span>
        </div>
      )}

      {/* Flyby autopilot status pill — sits beside/below the approach pill. */}
      {state.flyby && (
        <div className="absolute left-1/2 top-36 -translate-x-1/2 hud-panel rounded-full border border-amber/60 bg-amber/10 px-3 py-1 text-center text-[10px] tracking-widest">
          <span className="text-hud-dim">FLYBY ·</span>{" "}
          <span className="text-amber">{state.flyby.target}</span>{" "}
          <span className="text-hud-dim">·</span>{" "}
          <span className="text-hud">{Math.round(state.flyby.progress * 100)}%</span>
        </div>
      )}
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
        {/* Passive sensor contact — fills as the nearest unscanned body
            approaches the 2000u sensor edge. Empty when nothing's in range. */}
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-hud-dim">SENSOR</span>
          <span className="text-[10px] text-hud-dim">
            {state.sensorContact ? `${state.sensorContact.distance.toFixed(0)}u` : "—"}
          </span>
        </div>
        <div className="relative mt-1 h-2 w-full overflow-hidden rounded bg-hud/10">
          <div
            className="h-full bg-hud transition-[width] duration-150 ease-out"
            style={{
              width: `${(state.sensorContact?.signal ?? 0) * 100}%`,
              boxShadow: state.sensorContact && state.sensorContact.signal > 0.6
                ? "0 0 8px oklch(var(--hud) / 0.6)"
                : undefined,
            }}
          />
        </div>
        <div className="mt-1 truncate text-[10px] text-amber">
          {state.sensorContact ? `· ${state.sensorContact.name}` : "no contact"}
        </div>
      </div>

      {/* Bottom-right: warp drive + boost burst indicator */}
      <div className="absolute bottom-6 right-6 hud-panel rounded-md px-4 py-3 text-xs" style={{ minWidth: 220 }}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
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
            <div className="mt-2 text-[10px] text-hud-dim">[HOLD SPACE] engage · [TAP] boost</div>
          </div>
          <BoostIndicator
            active={state.boostBurst}
            cooldown={state.boostCooldown}
            cooldownMax={state.boostCooldownMax}
            duration={state.boostDuration}
            remaining={state.boostRemaining}
          />
        </div>
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

      {/* Physical cockpit hardware: a flight yoke that tilts with steering and a
          thrust lever that slides with the throttle. Sits just inside the bottom
          dashboard. Hidden on small screens to avoid crowding mobile controls. */}
      <CockpitControls
        yoke={{ pitch: state.heading.pitch, yaw: state.heading.yaw }}
        thrust={state.thrust}
        boost={state.boost}
      />

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

      {/* Proximity vignette: tints the screen edges with the nearest body's
          atmosphere color when the ship is within ~6× its radius. */}
      {state.proximity && state.proximity.closeness > 0.05 && (
        <div
          className="proximity-vignette"
          style={{
            opacity: Math.min(0.85, state.proximity.closeness * 0.9),
            background: `radial-gradient(ellipse at center, transparent 40%, ${state.proximity.color}55 80%, ${state.proximity.color}cc 100%)`,
          }}
        />
      )}

      {/* System-completion medal — pops when every body in a star system is scanned. */}
      {state.medal && <SystemMedal systemName={state.medal.systemName} bodyCount={state.medal.bodyCount} />}

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

      {/* Pause overlay — also doubles as a quick controls reference. */}
      {state.paused && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="hud-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg p-8 text-center">
            <div className="font-display text-3xl text-hud hud-glow">PAUSED</div>

            <div className="mt-6 text-left">
              <div className="mb-2 font-display text-[11px] tracking-widest text-amber">FLIGHT CONTROLS</div>
              <ul className="space-y-1.5 font-display text-[11px] tracking-wider text-hud-dim">
                <li><span className="text-hud">MOUSE</span> · steer (pitch / yaw)</li>
                <li><span className="text-hud">W / S</span> · thrust forward / reverse</li>
                <li><span className="text-hud">SHIFT</span> · sustained afterburner</li>
                <li><span className="text-hud">SPACE (tap)</span> · 2-second boost burst <span className="text-hud-dim">(1s cooldown)</span></li>
                <li><span className="text-hud">SPACE (hold 1s)</span> · engage lightspeed (10s, jumps systems)</li>
                <li><span className="text-hud">F / G / H</span> · frame · approach · flyby · <span className="text-hud">X</span> abort</li>
                <li><span className="text-hud">[ ]</span> alt · <span className="text-hud">; '</span> offset · <span className="text-hud">, .</span> duration</li>
                <li><span className="text-hud">+ / −</span> · minimap zoom</li>
                <li><span className="text-hud">ESC</span> · pause / resume</li>
              </ul>
              <div className="mt-3 font-display text-[10px] tracking-wider text-hud-dim">
                Lock the reticle on a body for ~4s to catalogue it. Survey every body in a system for a medal.
              </div>
            </div>

            <FlybyPanel
              config={state.flybyConfig}
              onChange={onFlybyConfigChange}
              activePass={state.flyby}
            />

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
 * Compact boost-burst dial that lives next to the warp drive bar. Three states:
 *  - READY      → solid amber ring, "BOOST" label, slow scan-pulse glow.
 *  - ACTIVE     → ring drains anti-clockwise as the 2s burst plays out, big "GO" label.
 *  - COOLDOWN   → ring fills clockwise from empty back to full over 1s.
 *
 * The arc is drawn with a stroke-dasharray trick — we set `dashoffset` from a
 * 0..1 fraction so we can animate it purely from React state without raf.
 */
function BoostIndicator({
  active,
  cooldown,
  cooldownMax,
  duration,
  remaining,
}: {
  active: boolean;
  cooldown: number;
  cooldownMax: number;
  duration: number;
  remaining: number;
}) {
  const R = 16;
  const C = 2 * Math.PI * R;
  // Fraction of the ring to *show* (1 = full, 0 = empty).
  let fill = 1;
  let label = "BOOST";
  let sub = "READY";
  let color = "text-amber";
  let ringClass = "stroke-amber";
  if (active) {
    fill = duration > 0 ? Math.max(0, remaining / duration) : 0;
    label = "GO";
    sub = `${remaining.toFixed(1)}s`;
    color = "text-amber";
    ringClass = "stroke-amber";
  } else if (cooldown > 0) {
    // Fill rises from 0 → 1 as cooldown counts down to 0.
    fill = cooldownMax > 0 ? 1 - cooldown / cooldownMax : 1;
    label = "COOL";
    sub = `${cooldown.toFixed(1)}s`;
    color = "text-hud-dim";
    ringClass = "stroke-hud";
  }
  const dashoffset = C * (1 - fill);
  return (
    <div className="flex shrink-0 flex-col items-center" aria-label={`Boost ${sub}`}>
      <div className="relative h-12 w-12">
        <svg viewBox="-20 -20 40 40" className="h-full w-full -rotate-90">
          {/* Track */}
          <circle r={R} fill="none" className="stroke-hud/15" strokeWidth="3" />
          {/* Fill */}
          <circle
            r={R}
            fill="none"
            className={`${ringClass} transition-[stroke-dashoffset] duration-150 ease-linear ${
              !active && cooldown <= 0 ? "scan-pulse" : ""
            }`}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center font-display text-[9px] tracking-widest ${color} ${
            active ? "hud-glow" : ""
          }`}
        >
          {label}
        </div>
      </div>
      <div className="mt-1 font-display text-[9px] tracking-widest text-hud-dim">{sub}</div>
    </div>
  );
}

/**
 * Centered cockpit reticle. When `scanning` is null we render the idle
 * crosshair; when a target is being scanned we light up corner brackets,
 * draw a circular progress ring (clockwise fill via stroke-dashoffset),
 * and label the target underneath.
 */
function LockOnReticle({
  scanning,
  warpHoldProgress,
}: {
  scanning: HUDState["scanning"];
  warpHoldProgress: number;
}) {
  // Outer "charging" ring shown while the pilot holds Space toward warp.
  // Lives outside the scan reticle (r=44) so it never collides visually.
  const WR = 44;
  const WC = 2 * Math.PI * WR;
  const charging = warpHoldProgress > 0.01;
  const warpReady = warpHoldProgress >= 0.999;
  const warpDashOffset = WC * (1 - Math.min(1, warpHoldProgress));
  const active = scanning != null;
  const alreadyScanned = scanning?.alreadyScanned === true;
  const progress = scanning?.progress ?? 0;
  // Ring geometry — circumference drives the dashoffset for a clockwise fill.
  const R = 36;
  const C = 2 * Math.PI * R;
  const dashOffset = C * (1 - progress);
  const locked = progress >= 0.999 && !alreadyScanned;

  // Brackets animate between "expanded" (outside the reticle, invisible) and
  // "snapped" (resting position, visible). We delay the active->snapped state
  // by a tick so the CSS transition always plays, even on first acquisition.
  const [snapped, setSnapped] = useState(false);
  useEffect(() => {
    if (!active) {
      setSnapped(false);
      return;
    }
    const id = requestAnimationFrame(() => setSnapped(true));
    return () => cancelAnimationFrame(id);
  }, [active]);

  // Color theme: amber while scanning a fresh body, cyan (text-hud) when the
  // body is already catalogued so the pilot knows not to bother re-aiming.
  const themeClass = !active
    ? "text-hud opacity-60"
    : alreadyScanned
      ? "text-hud"
      : "text-amber";

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg width="100" height="100" viewBox="0 0 100 100" className={themeClass}>
        {/* Warp hold-charge ring — sits outside the scan reticle and fills
            clockwise as the pilot holds Space. Flashes amber on lock. */}
        {charging && (
          <g className={warpReady ? "text-amber" : "text-hud"}>
            <circle
              cx="50"
              cy="50"
              r={WR}
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="1.5"
              fill="none"
            />
            <circle
              cx="50"
              cy="50"
              r={WR}
              stroke="currentColor"
              strokeWidth={warpReady ? 3 : 2}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={WC}
              strokeDashoffset={warpDashOffset}
              transform="rotate(-90 50 50)"
              className={warpReady ? "hud-glow" : ""}
              style={{ transition: "stroke-dashoffset 60ms linear" }}
              opacity={0.95}
            />
            {/* Tiny "WARP" label below the reticle while charging. */}
            <text
              x="50"
              y="100"
              textAnchor="middle"
              fontSize="6"
              letterSpacing="2"
              fill="currentColor"
              opacity={warpReady ? 1 : 0.8}
              className={warpReady ? "scan-pulse" : ""}
            >
              {warpReady ? "ENGAGE" : "WARP…"}
            </text>
          </g>
        )}
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

        {active && !alreadyScanned && (
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
          </>
        )}

        {active && (
          <>
            {/* Corner lock brackets — fly in from their own corner. For an
                already-scanned target they stay small/solid and don't pulse,
                so the reticle reads as "info, not action required". */}
            {[
              { d: "M14,26 L14,14 L26,14", origin: "14px 14px" },
              { d: "M74,14 L86,14 L86,26", origin: "86px 14px" },
              { d: "M86,74 L86,86 L74,86", origin: "86px 86px" },
              { d: "M26,86 L14,86 L14,74", origin: "14px 86px" },
            ].map(({ d, origin }) => (
              <path
                key={d}
                d={d}
                stroke="currentColor"
                strokeWidth={alreadyScanned ? 1.4 : 2}
                fill="none"
                strokeLinecap="round"
                opacity={alreadyScanned ? 0.85 : 1}
                style={{
                  transformOrigin: origin,
                  transform: snapped
                    ? alreadyScanned
                      ? "scale(0.78)"
                      : "scale(1)"
                    : "scale(1.6)",
                  opacity: snapped ? (alreadyScanned ? 0.85 : 1) : 0,
                  transition:
                    "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease-out",
                }}
              />
            ))}
          </>
        )}
      </svg>
      {active && (
        <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap text-center">
          <div
            className={`text-[10px] tracking-widest ${alreadyScanned ? "text-hud" : "text-hud-dim"}`}
          >
            {alreadyScanned ? "CATALOGUED" : locked ? "LOCKED" : "SCANNING"}
          </div>
          <div
            className={`text-sm tracking-wider ${
              alreadyScanned
                ? "text-hud opacity-80"
                : locked
                  ? "text-amber hud-glow scan-pulse"
                  : "text-amber"
            }`}
          >
            {scanning?.name}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Visible cockpit hardware: a yoke that physically tilts with steering input
 * and a thrust lever that slides with the throttle. Pure SVG so it costs
 * nothing per frame and inherits the HUD theme via `currentColor`. Hidden on
 * narrow screens so it doesn't fight the mobile joystick UI.
 */
function CockpitControls({
  yoke,
  thrust,
  boost,
}: {
  yoke: { pitch: number; yaw: number };
  thrust: number;
  boost: boolean;
}) {
  // Map ship rotation (radians) into yoke deflection. Steering uses small
  // angles in normal flight, so a generous multiplier keeps the yoke visibly
  // alive without ever pinning to the rails.
  const tiltDeg = Math.max(-22, Math.min(22, ((yoke.yaw * 180) / Math.PI) * 0.6));
  const pitchPx = Math.max(-10, Math.min(10, ((yoke.pitch * 180) / Math.PI) * 0.4));
  // Lever travel: -1 (full reverse, lever down) → +1 (full forward, lever up).
  const t = Math.max(-1, Math.min(1, thrust));
  const leverY = -t * 36; // px offset from neutral

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 block h-[180px]">
      {/* YOKE — left of the artificial horizon */}
      <div
        className="absolute bottom-2 left-1/2"
        style={{
          transform: `translateX(-180px) translateY(${pitchPx}px) rotate(${tiltDeg}deg)`,
          transformOrigin: "50% 90%",
          transition: "transform 90ms linear",
        }}
      >
        <svg width="140" height="110" viewBox="0 0 140 110" className="text-hud">
          {/* Column / base */}
          <rect x="60" y="80" width="20" height="28" rx="3" fill="#0a1118" stroke="currentColor" strokeOpacity="0.5" />
          <rect x="50" y="98" width="40" height="10" rx="2" fill="#0d1620" stroke="currentColor" strokeOpacity="0.45" />
          {/* Cross handle */}
          <rect x="14" y="44" width="112" height="14" rx="6" fill="#101a24" stroke="currentColor" strokeOpacity="0.7" />
          {/* Center hub */}
          <circle cx="70" cy="51" r="11" fill="#0a1118" stroke="currentColor" strokeOpacity="0.85" />
          <circle cx="70" cy="51" r="3" fill="currentColor" opacity="0.85" />
          {/* Grip caps */}
          <rect x="6" y="38" width="14" height="26" rx="4" fill="#0a1118" stroke="currentColor" strokeOpacity="0.7" />
          <rect x="120" y="38" width="14" height="26" rx="4" fill="#0a1118" stroke="currentColor" strokeOpacity="0.7" />
          {/* Trigger LEDs on each grip — amber when steering hard that side */}
          <circle cx="13" cy="44" r="1.6" fill="#fbbf24" opacity={tiltDeg < -8 ? 1 : 0.25} />
          <circle cx="127" cy="44" r="1.6" fill="#fbbf24" opacity={tiltDeg > 8 ? 1 : 0.25} />
          {/* Hub tick */}
          <line x1="70" y1="44" x2="70" y2="48" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      {/* THRUST LEVER — right of the artificial horizon */}
      <div
        className="absolute bottom-2 left-1/2"
        style={{ transform: "translateX(120px)" }}
      >
        <svg width="60" height="150" viewBox="0 0 60 150" className="text-hud">
          {/* Track */}
          <rect x="22" y="14" width="16" height="116" rx="4" fill="#0a1118" stroke="currentColor" strokeOpacity="0.5" />
          {/* Notch ticks */}
          <line x1="18" y1="20" x2="42" y2="20" stroke="currentColor" strokeOpacity="0.4" />
          <line x1="18" y1="72" x2="42" y2="72" stroke="currentColor" strokeOpacity="0.6" />
          <line x1="18" y1="124" x2="42" y2="124" stroke="currentColor" strokeOpacity="0.4" />
          <text x="46" y="22" fontSize="6" fill="currentColor" opacity="0.6">F</text>
          <text x="46" y="74" fontSize="6" fill="currentColor" opacity="0.6">0</text>
          <text x="46" y="126" fontSize="6" fill="currentColor" opacity="0.6">R</text>
          {/* Lever */}
          <g
            style={{
              transform: `translateY(${leverY}px)`,
              transition: "transform 90ms linear",
            }}
          >
            <rect x="14" y="66" width="32" height="14" rx="3" fill="#101a24" stroke="currentColor" strokeOpacity="0.85" />
            <rect x="18" y="60" width="24" height="6" rx="2" fill="#0a1118" stroke="currentColor" strokeOpacity="0.7" />
            <circle
              cx="30"
              cy="73"
              r="2"
              fill={t > 0.05 ? "#22d3ee" : t < -0.05 ? "#fbbf24" : "currentColor"}
              opacity={Math.abs(t) > 0.05 ? 1 : 0.4}
            />
          </g>
        </svg>
      </div>

      {/* BOOST INDICATOR — circular button beside the thrust lever. Lights
          red and pulses while SHIFT is held. Cosmetic; the actual boost is
          driven by the SHIFT key listener in the scene. */}
      <div
        className="pointer-events-none absolute bottom-4 left-1/2"
        style={{ transform: "translateX(190px)" }}
        aria-label={boost ? "Boost engaged" : "Boost ready"}
      >
        <svg width="56" height="80" viewBox="0 0 56 80" className="text-hud">
          {/* Mount plate */}
          <rect x="6" y="44" width="44" height="30" rx="4" fill="#0a1118" stroke="currentColor" strokeOpacity="0.55" />
          {/* Outer bezel */}
          <circle
            cx="28"
            cy="28"
            r="22"
            fill="#0a1118"
            stroke={boost ? "#ef4444" : "currentColor"}
            strokeOpacity={boost ? 1 : 0.7}
            strokeWidth="2"
            style={{
              filter: boost
                ? "drop-shadow(0 0 6px #ef4444) drop-shadow(0 0 14px rgba(239,68,68,0.7))"
                : "none",
              transition: "filter 120ms linear",
            }}
          />
          {/* Inner button face */}
          <circle
            cx="28"
            cy="28"
            r="16"
            fill={boost ? "#7f1d1d" : "#101a24"}
            stroke={boost ? "#fca5a5" : "currentColor"}
            strokeOpacity={boost ? 0.9 : 0.5}
          />
          {/* Lightning bolt glyph */}
          <path
            d="M30,17 L21,31 L27,31 L25,40 L34,26 L28,26 L30,17 Z"
            fill={boost ? "#fde68a" : "currentColor"}
            opacity={boost ? 1 : 0.55}
          />
          {/* Label */}
          <text
            x="28"
            y="62"
            textAnchor="middle"
            fontSize="8"
            letterSpacing="1.5"
            fill={boost ? "#ef4444" : "currentColor"}
            opacity={boost ? 1 : 0.65}
          >
            BOOST
          </text>
        </svg>
      </div>

      {/* TOGGLE SWITCH ROW — purely cosmetic flight-deck detail above the
          thrust lever. Each switch flips on click with a subtle LED + label. */}
      <ToggleSwitchPanel />
    </div>
  );
}

/**
 * Decorative cockpit switch row: LIGHTS / SHIELDS / SCANNER. Each toggle is
 * a small SVG that animates between up (on) and down (off) positions and
 * lights an LED. State is local — these don't affect gameplay.
 */
function ToggleSwitchPanel() {
  const [switches, setSwitches] = useState<Record<string, boolean>>({
    LIGHTS: true,
    SHIELDS: true,
    SCANNER: true,
  });
  const labels = ["LIGHTS", "SHIELDS", "SCANNER"] as const;
  const ledColor: Record<(typeof labels)[number], string> = {
    LIGHTS: "#22d3ee",
    SHIELDS: "#a78bfa",
    SCANNER: "#fbbf24",
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-[150px] left-1/2 flex gap-3 hud-panel rounded-md px-3 py-2"
      style={{ transform: "translateX(90px)" }}
      aria-label="Cockpit toggle switches"
    >
      {labels.map((label) => {
        const on = switches[label];
        return (
          <button
            key={label}
            type="button"
            onClick={() => setSwitches((s) => ({ ...s, [label]: !s[label] }))}
            className="flex flex-col items-center gap-1 px-1 outline-none"
            aria-pressed={on}
            aria-label={`${label} ${on ? "on" : "off"}`}
          >
            <svg width="22" height="40" viewBox="0 0 22 40" className="text-hud">
              {/* Switch frame */}
              <rect x="3" y="4" width="16" height="32" rx="3" fill="#0a1118" stroke="currentColor" strokeOpacity="0.6" />
              {/* Up/Down notch markers */}
              <line x1="6" y1="9" x2="16" y2="9" stroke="currentColor" strokeOpacity="0.3" />
              <line x1="6" y1="31" x2="16" y2="31" stroke="currentColor" strokeOpacity="0.3" />
              {/* Toggle bat — slides between top (on) and bottom (off) */}
              <g
                style={{
                  transform: on ? "translateY(0px)" : "translateY(14px)",
                  transition: "transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                <rect x="8" y="8" width="6" height="14" rx="2" fill="#1a2532" stroke="currentColor" strokeOpacity="0.85" />
                <circle cx="11" cy="10" r="1.6" fill={on ? ledColor[label] : "currentColor"} opacity={on ? 1 : 0.35} />
              </g>
            </svg>
            <span
              className="text-[8px] tracking-[0.15em]"
              style={{ color: on ? ledColor[label] : "var(--hud-dim)" }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Flyby tuning panel — three sliders for altitude, closest-approach offset,
 * and pass duration. Changes apply to the NEXT engagement, so we surface a
 * dim hint while a flyby is currently flying.
 */
const FLYBY_LIMITS = {
  altitudeMul: { min: 1.5, max: 8, step: 0.25 },
  offsetMul: { min: -3, max: 3, step: 0.25 },
  durationMul: { min: 0.5, max: 2.5, step: 0.1 },
};

function FlybyPanel({
  config,
  onChange,
  activePass,
}: {
  config: HUDState["flybyConfig"];
  onChange?: (cfg: Partial<HUDState["flybyConfig"]>) => void;
  activePass: HUDState["flyby"];
}) {
  if (!onChange) return null;
  const rows: Array<{
    key: keyof HUDState["flybyConfig"];
    label: string;
    suffix: string;
    hint: string;
  }> = [
    { key: "altitudeMul", label: "ALTITUDE", suffix: "× R", hint: "[ ]" },
    { key: "offsetMul", label: "OFFSET", suffix: "× R", hint: "; '" },
    { key: "durationMul", label: "DURATION", suffix: "×", hint: ", ." },
  ];
  return (
    <div className="mt-6 text-left">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-[11px] tracking-widest text-amber">FLYBY TUNING</span>
        {activePass && (
          <span className="text-[9px] tracking-widest text-hud-dim">applies next engage</span>
        )}
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const lim = FLYBY_LIMITS[row.key];
          const val = config[row.key];
          return (
            <div key={row.key}>
              <div className="mb-1 flex items-baseline justify-between font-display text-[10px] tracking-widest">
                <span className="text-hud-dim">
                  {row.label} <span className="text-hud/40">{row.hint}</span>
                </span>
                <span className="text-hud">
                  {val.toFixed(2)}
                  <span className="ml-0.5 text-hud-dim">{row.suffix}</span>
                </span>
              </div>
              <input
                type="range"
                min={lim.min}
                max={lim.max}
                step={lim.step}
                value={val}
                onChange={(e) => onChange({ [row.key]: parseFloat(e.target.value) })}
                className="h-1 w-full cursor-pointer accent-hud"
                aria-label={row.label}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Celebratory medal that pops onto the HUD when the pilot completes scanning
 * every body in a star system. Pure SVG so it inherits the HUD palette and
 * stays crisp at any size.
 */
function SystemMedal({ systemName, bodyCount }: { systemName: string; bodyCount: number }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 text-center">
      <div className="medal-pop hud-panel rounded-xl px-6 py-5">
        <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto block text-amber">
          {/* Ribbon */}
          <path d="M40,10 L52,52 L60,46 L68,52 L80,10 Z" fill="#7c2d12" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.5" />
          <path d="M40,10 L60,46 L80,10" fill="#9a3412" opacity="0.85" />
          {/* Outer medal disc */}
          <circle cx="60" cy="76" r="32" fill="#1a1208" stroke="currentColor" strokeWidth="2" />
          <circle cx="60" cy="76" r="28" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 3" />
          {/* Laurel leaves around the rim */}
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const cx = 60 + Math.cos(a) * 30;
            const cy = 76 + Math.sin(a) * 30;
            return (
              <ellipse
                key={i}
                cx={cx}
                cy={cy}
                rx="4"
                ry="2.2"
                fill="currentColor"
                opacity="0.75"
                transform={`rotate(${(a * 180) / Math.PI + 90} ${cx} ${cy})`}
              />
            );
          })}
          {/* Star at center */}
          <path
            d="M60,58 L64,70 L77,70 L66.5,77.5 L70.5,90 L60,82 L49.5,90 L53.5,77.5 L43,70 L56,70 Z"
            fill="currentColor"
            stroke="#7c2d12"
            strokeWidth="1"
          />
        </svg>
        <div className="mt-2 text-[10px] tracking-[0.3em] text-hud-dim">SYSTEM SURVEYED</div>
        <div className="mt-1 font-display text-2xl text-amber hud-glow">{systemName}</div>
        <div className="mt-1 text-xs text-hud-dim">{bodyCount} bodies catalogued · +1000</div>
      </div>
    </div>
  );
}