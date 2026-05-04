import { useEffect, useMemo, useState } from "react";
import { getNearbySystems, sectorFor, type GalaxyNode } from "@/lib/galaxy";
import { generateName } from "@/lib/journal";

const SIZE = 640;
const R = SIZE / 2;

const KIND_COLOR: Record<GalaxyNode["kind"], string> = {
  star: "#ffe6a0",
  "blue-giant": "#9ad0ff",
  "red-dwarf": "#ff7060",
};

const KIND_LABEL: Record<GalaxyNode["kind"], string> = {
  star: "STAR",
  "blue-giant": "BLUE GIANT",
  "red-dwarf": "RED DWARF",
};

type Props = {
  open: boolean;
  currentSeed: number;
  visited: Set<number>;
  onJumpTo: (seed: number) => void;
  onClose: () => void;
};

/** Fullscreen Galaxy Map overlay: click a star to warp directly to that seed. */
export function GalaxyMap({ open, currentSeed, visited, onJumpTo, onClose }: Props) {
  const [selected, setSelected] = useState<GalaxyNode | null>(null);
  const [hover, setHover] = useState<GalaxyNode | null>(null);

  const nodes = useMemo(
    () => getNearbySystems(currentSeed, visited, 24),
    [currentSeed, visited],
  );

  // Reset selection when re-opened so stale jumps don't carry over.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  // Keybindings: Esc/M close; J confirms a pending jump.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyM") {
        e.preventDefault();
        onClose();
      } else if (e.code === "KeyJ" && selected) {
        e.preventDefault();
        onJumpTo(selected.seed);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, onJumpTo, onClose]);

  if (!open) return null;

  const currentName = generateName(currentSeed * 1000);
  const currentSector = sectorFor(currentSeed);
  const active = hover ?? selected;

  return (
    <div
      data-hud-safe="true"
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hud-panel relative max-w-[95vw] max-h-[95vh] rounded-lg p-4">
        <div className="mb-2 flex items-center justify-between gap-4 px-1">
          <div className="font-display text-sm tracking-[0.3em] text-hud">
            GALAXY MAP <span className="text-hud-dim">·</span>{" "}
            <span className="text-amber">{currentName}</span>{" "}
            <span className="text-[10px] text-hud-dim">{currentSector}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-hud/40 px-2 py-0.5 font-display text-[10px] tracking-widest text-hud-dim hover:bg-hud/10 hover:text-hud"
            aria-label="Close galaxy map"
          >
            ESC ✕
          </button>
        </div>

        <div className="relative" style={{ width: Math.min(SIZE, 0.9 * window.innerWidth), height: Math.min(SIZE, 0.7 * window.innerHeight) }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-full w-full">
            <defs>
              <radialGradient id="gx-bg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="oklch(0.18 0.06 240)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="oklch(0.06 0.04 240)" stopOpacity="1" />
              </radialGradient>
            </defs>
            <circle cx={R} cy={R} r={R - 1} fill="url(#gx-bg)" stroke="currentColor" strokeOpacity="0.3" className="text-hud" />
            {/* Range rings */}
            {[0.25, 0.5, 0.75].map((f) => (
              <circle key={f} cx={R} cy={R} r={R * f} fill="none" stroke="currentColor" strokeOpacity="0.1" className="text-hud" />
            ))}
            {/* Crosshair */}
            <line x1={R} y1={4} x2={R} y2={SIZE - 4} stroke="currentColor" strokeOpacity="0.08" className="text-hud" />
            <line x1={4} y1={R} x2={SIZE - 4} y2={R} stroke="currentColor" strokeOpacity="0.08" className="text-hud" />

            {/* "You are here" star at center */}
            <g transform={`translate(${R} ${R})`}>
              <circle r="12" fill="none" stroke="#ffb347" strokeWidth="1.4">
                <animate attributeName="r" values="10;18;10" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle r="5" fill="#ffe6a0" />
              <circle r="8" fill="#ffe6a0" opacity="0.3" />
            </g>

            {/* Connection lines from center to selected node */}
            {selected && (
              <line
                x1={R}
                y1={R}
                x2={R + selected.x * (R - 18)}
                y2={R + selected.y * (R - 18)}
                stroke="#ffb347"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity={0.6}
              />
            )}

            {/* Nodes */}
            {nodes.map((n) => {
              const px = R + n.x * (R - 18);
              const py = R + n.y * (R - 18);
              const color = KIND_COLOR[n.kind];
              const baseR = n.kind === "blue-giant" ? 5 : n.kind === "red-dwarf" ? 4 : 4.5;
              const isSelected = selected?.seed === n.seed;
              return (
                <g key={n.seed} style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover((h) => (h?.seed === n.seed ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(n);
                  }}
                >
                  {isSelected && (
                    <circle cx={px} cy={py} r={baseR + 8} fill="none" stroke="#ffb347" strokeWidth="1.5">
                      <animate attributeName="r" values={`${baseR + 6};${baseR + 12};${baseR + 6}`} dur="1.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {n.visited ? (
                    <circle cx={px} cy={py} r={baseR} fill={color} />
                  ) : (
                    <circle cx={px} cy={py} r={baseR} fill="none" stroke={color} strokeWidth="1.4" />
                  )}
                  <circle cx={px} cy={py} r={baseR + 3} fill={color} opacity="0.18" />
                  {/* Hit area */}
                  <circle cx={px} cy={py} r={Math.max(14, baseR + 8)} fill="transparent" />
                  <text
                    x={px}
                    y={py + baseR + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fill="currentColor"
                    className="text-hud-dim font-display"
                    style={{ pointerEvents: "none", letterSpacing: "0.1em" }}
                  >
                    {n.name.toUpperCase()}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover/selection tooltip */}
          {active && (
            <div
              className="pointer-events-none absolute left-2 top-2 rounded border border-hud/50 bg-background/95 px-2 py-1.5 text-[11px] leading-tight text-hud shadow"
            >
              <div className="font-display text-amber tracking-widest">{active.name}</div>
              <div className="text-hud-dim">{active.sector}</div>
              <div className="text-hud-dim">
                {KIND_LABEL[active.kind]} · {active.distanceJumps} JUMP{active.distanceJumps === 1 ? "" : "S"}
                {active.visited && <span className="ml-1 text-amber">· VISITED</span>}
              </div>
            </div>
          )}
        </div>

        {/* Confirmation strip */}
        <div className="mt-3 flex items-center justify-between gap-3 px-1">
          <div className="text-[10px] tracking-widest text-hud-dim">
            CLICK A SYSTEM · <span className="text-hud">[J]</span> CONFIRM JUMP · <span className="text-hud">[ESC]</span> CLOSE
          </div>
          {selected ? (
            <button
              type="button"
              onClick={() => {
                onJumpTo(selected.seed);
                onClose();
              }}
              className="rounded border border-amber/60 bg-amber/10 px-3 py-1 font-display text-xs tracking-widest text-amber hover:bg-amber/20"
            >
              ▶ JUMP TO {selected.name.toUpperCase()}
            </button>
          ) : (
            <span className="font-display text-xs tracking-widest text-hud-dim">
              NO DESTINATION SELECTED
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
