import { useEffect, useRef, useState } from "react";

export type MinimapDot = {
  x: number; // -1..1 (right)
  z: number; // -1..1 (forward; negative = ahead)
  kind: "planet" | "ringed-planet" | "moon" | "star" | "blue-giant" | "red-dwarf" | "orb";
  scanned: boolean;
  isTarget: boolean;
  ahead: boolean;
  distance: number;
  name?: string;
};

export type MinimapData = {
  dots: MinimapDot[];
  range: number;
  offRangeTarget: { x: number; z: number; distance: number } | null;
  /** Names of bodies scanned in the last few seconds — pulse their dots. */
  freshlyScanned?: Set<string>;
};

const KIND_COLOR: Record<MinimapDot["kind"], string> = {
  planet: "#6aa8ff",
  "ringed-planet": "#e8c97a",
  moon: "#bdb6a8",
  star: "#ffe6a0",
  "blue-giant": "#9ad0ff",
  "red-dwarf": "#ff7060",
  orb: "#88ffcc",
};

const SIZE = 160;
const R = SIZE / 2;

export function Minimap({
  data,
  objective,
  onZoomIn,
  onZoomOut,
}: {
  data: MinimapData | null;
  objective: string;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}) {
  // Track the dot under the cursor for the hover tooltip.
  const [hover, setHover] = useState<{ dot: MinimapDot; x: number; y: number } | null>(null);
  // On touch, a tap "pins" the tooltip until the user taps elsewhere.
  const [pinned, setPinned] = useState<{ dot: MinimapDot; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Dismiss pinned tooltip when tapping/clicking anywhere outside the minimap panel.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setPinned(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  const active = pinned ?? hover;

  // Find nearest target dot for live distance readout
  const target = data?.dots.reduce<MinimapDot | null>((best, d) => {
    if (!d.isTarget) return best;
    if (!best || d.distance < best.distance) return d;
    return best;
  }, null) ?? null;

  return (
    <div ref={containerRef} className="hud-panel rounded-md p-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-widest text-hud-dim">
        <span>STAR MAP</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onZoomOut}
            className="rounded border border-hud/40 px-1 leading-none text-hud-dim hover:bg-hud/10 hover:text-hud"
            aria-label="Zoom out (increase range)"
            title="Zoom out (-)"
          >
            −
          </button>
          <span className="min-w-[42px] text-right text-amber">{Math.round(data?.range ?? 800)}u</span>
          <button
            type="button"
            onClick={onZoomIn}
            className="rounded border border-hud/40 px-1 leading-none text-hud-dim hover:bg-hud/10 hover:text-hud"
            aria-label="Zoom in (decrease range)"
            title="Zoom in (+)"
          >
            +
          </button>
        </div>
      </div>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
        {/* Background */}
        <defs>
          <radialGradient id="mm-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.18 0.05 220)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.08 0.04 220)" stopOpacity="0.95" />
          </radialGradient>
        </defs>
        <circle cx={R} cy={R} r={R - 1} fill="url(#mm-bg)" stroke="currentColor" strokeOpacity="0.3" className="text-hud" />
        {/* Range rings */}
        <circle cx={R} cy={R} r={R * 0.66} fill="none" stroke="currentColor" strokeOpacity="0.15" className="text-hud" />
        <circle cx={R} cy={R} r={R * 0.33} fill="none" stroke="currentColor" strokeOpacity="0.15" className="text-hud" />
        {/* Crosshair */}
        <line x1={R} y1={4} x2={R} y2={SIZE - 4} stroke="currentColor" strokeOpacity="0.15" className="text-hud" />
        <line x1={4} y1={R} x2={SIZE - 4} y2={R} stroke="currentColor" strokeOpacity="0.15" className="text-hud" />
        {/* Forward arc highlight */}
        <path
          d={`M ${R} ${R} L ${R - R * 0.7} ${R - R * 0.7} A ${R} ${R} 0 0 1 ${R + R * 0.7} ${R - R * 0.7} Z`}
          fill="currentColor"
          fillOpacity="0.05"
          className="text-hud"
        />

        {/* Dots */}
        {data?.dots.map((d, i) => {
          // Map ship-local: x → screen-x, z → screen-y (negative z = ahead = up)
          const px = R + d.x * (R - 6);
          const py = R + d.z * (R - 6);
          const color = KIND_COLOR[d.kind];
          const isStar = d.kind === "star" || d.kind === "blue-giant" || d.kind === "red-dwarf";
          const baseR = isStar ? 3 : d.kind === "orb" ? 1.5 : d.kind === "moon" ? 1.4 : 2.5;
          // Scanned bodies: solid filled dot (catalogued — known waypoint).
          // Unscanned bodies: hollow ring (still to investigate).
          // Stars and orbs always render solid since they're not "scannable" in the same way.
          const isHollow = !d.scanned && !isStar && d.kind !== "orb";
          const isFresh = !!(d.name && data?.freshlyScanned?.has(d.name));
          return (
            <g key={i}>
              {d.isTarget && (
                <>
                  <circle cx={px} cy={py} r={9} fill="none" stroke="#ffb347" strokeWidth="1.2">
                    <animate attributeName="r" values="6;12;6" dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.9;0.2;0.9" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                  <path
                    d={`M ${px - 6} ${py - 6} L ${px - 2} ${py - 6} M ${px + 6} ${py - 6} L ${px + 2} ${py - 6} M ${px - 6} ${py + 6} L ${px - 2} ${py + 6} M ${px + 6} ${py + 6} L ${px + 2} ${py + 6}`}
                    stroke="#ffb347"
                    strokeWidth="1.2"
                    fill="none"
                  />
                </>
              )}
              {isFresh && (
                <circle cx={px} cy={py} r={baseR} fill="none" stroke={color} strokeWidth="1.4">
                  <animate attributeName="r" values={`${baseR};${baseR + 10};${baseR + 14}`} dur="1.6s" repeatCount="3" />
                  <animate attributeName="opacity" values="1;0.4;0" dur="1.6s" repeatCount="3" />
                  <animate attributeName="stroke-width" values="1.6;1;0.4" dur="1.6s" repeatCount="3" />
                </circle>
              )}
              {isHollow ? (
                <circle cx={px} cy={py} r={baseR} fill="none" stroke={color} strokeWidth={1.2} opacity={0.9} />
              ) : (
                <circle cx={px} cy={py} r={baseR} fill={color} opacity={1} />
              )}
              {isStar && (
                <circle cx={px} cy={py} r={baseR + 2} fill={color} opacity={0.25} />
              )}
              {/* Transparent hit-target for hover/tap tooltip (always large enough to grab). */}
              <circle
                cx={px}
                cy={py}
                r={Math.max(9, baseR + 5)}
                fill="transparent"
                style={{ cursor: "pointer", touchAction: "manipulation" }}
                onMouseEnter={() => setHover({ dot: d, x: px, y: py })}
                onMouseLeave={() => setHover((h) => (h?.dot === d ? null : h))}
                onPointerDown={(e) => {
                  if (e.pointerType === "touch" || e.pointerType === "pen") {
                    e.stopPropagation();
                    setPinned((p) => (p?.dot === d ? null : { dot: d, x: px, y: py }));
                  }
                }}
              />
            </g>
          );
        })}

        {/* Off-radar objective arrow on the rim */}
        {data?.offRangeTarget && (() => {
          const t = data.offRangeTarget;
          // Map ship-local x/z to screen: x → right, -z → up (forward = up)
          const len = Math.hypot(t.x, t.z) || 1;
          const ux = t.x / len;
          const uz = t.z / len;
          const rim = R - 8;
          const px = R + ux * rim;
          const py = R + uz * rim;
          // Angle so triangle points outward from center (screen-space)
          const angleDeg = (Math.atan2(uz, ux) * 180) / Math.PI + 90;
          return (
            <g transform={`translate(${px} ${py}) rotate(${angleDeg})`}>
              <polygon points="0,-7 -5,4 5,4" fill="#ffb347" stroke="#ffb347" strokeOpacity="0.4" strokeWidth="2">
                <animate attributeName="opacity" values="0.6;1;0.6" dur="1.4s" repeatCount="indefinite" />
              </polygon>
            </g>
          );
        })()}

        {/* Ship heading triangle (always at center, pointing up) */}
        <g transform={`translate(${R} ${R})`}>
          <polygon points="0,-7 -5,5 5,5" fill="oklch(0.85 0.18 200)" stroke="oklch(1 0 0)" strokeWidth="0.5" />
          <circle r="1.5" fill="oklch(1 0 0)" />
        </g>
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-hud/50 bg-background/95 px-1.5 py-1 text-[10px] leading-tight text-hud shadow"
          style={{
            // Position above-and-right of the dot; flip to left if near right edge.
            left: active.x > SIZE - 80 ? active.x - 8 : active.x + 8,
            top: active.y > SIZE - 40 ? active.y - 8 : active.y + 8,
            transform: `translate(${active.x > SIZE - 80 ? "-100%" : "0"}, ${active.y > SIZE - 40 ? "-100%" : "0"})`,
          }}
        >
          <div className="font-display text-amber">{active.dot.name ?? formatKind(active.dot.kind)}</div>
          <div className="text-hud-dim">
            {formatKind(active.dot.kind)} · {formatDist(active.dot.distance)}
            {active.dot.kind !== "orb" && (active.dot.kind === "star" || active.dot.kind === "blue-giant" || active.dot.kind === "red-dwarf"
              ? ""
              : active.dot.scanned ? " · CATALOGUED" : " · UNSCANNED")}
          </div>
        </div>
      )}
      </div>
      <div className="mt-1 truncate px-1 text-[10px] text-hud-dim">
        TGT: <span className="text-amber">{shortObjective(objective)}</span>
      </div>
      <div className="px-1 text-[10px] text-hud-dim">
        DIST:{" "}
        <span className="text-amber">
          {target ? formatDist(target.distance) : data?.offRangeTarget ? formatDist(data.offRangeTarget.distance) : "—"}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 px-1 text-[9px] uppercase tracking-wider text-hud-dim">
        <span className="flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
            <circle cx="4" cy="4" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" className="text-hud" />
          </svg>
          unscanned
        </span>
        <span aria-hidden>·</span>
        <span className="flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
            <circle cx="4" cy="4" r="2.5" fill="currentColor" className="text-hud" />
          </svg>
          catalogued
        </span>
        <span aria-hidden>·</span>
        <span className="flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <circle cx="5" cy="5" r="4" fill="none" stroke="#ffb347" strokeWidth="1" />
            <circle cx="5" cy="5" r="1.5" fill="#ffb347" />
          </svg>
          <span style={{ color: "#ffb347" }}>objective</span>
        </span>
      </div>
    </div>
  );
}

function shortObjective(o: string): string {
  if (o.length <= 22) return o;
  return o.slice(0, 21) + "…";
}

function formatDist(d: number): string {
  if (d >= 10000) return `${(d / 1000).toFixed(1)}ku`;
  if (d >= 1000) return `${(d / 1000).toFixed(2)}ku`;
  return `${Math.round(d)}u`;
}

const KIND_LABEL: Record<MinimapDot["kind"], string> = {
  planet: "PLANET",
  "ringed-planet": "RINGED PLANET",
  moon: "MOON",
  star: "STAR",
  "blue-giant": "BLUE GIANT",
  "red-dwarf": "RED DWARF",
  orb: "ENERGY ORB",
};

function formatKind(k: MinimapDot["kind"]): string {
  return KIND_LABEL[k];
}
