type Props = {
  paused: boolean;
  onToggle: () => void;
};

/**
 * HUD-styled pause toggle pinned top-right of the cockpit.
 *
 * Carries `data-hud-safe="true"` so the steering dead-zone logic in
 * `useSpaceScene` knows not to drift the ship while the cursor is parked
 * over this button.
 */
export function PauseButton({ paused, onToggle }: Props) {
  return (
    <div
      data-hud-safe="true"
      className="pointer-events-auto absolute top-6 right-32 z-30 flex flex-col items-end gap-1"
    >
      <button
        onClick={onToggle}
        aria-label={paused ? "Resume" : "Pause"}
        title={paused ? "Resume (Esc)" : "Pause (Esc)"}
        className="hud-panel flex h-12 w-12 items-center justify-center rounded-full font-display text-lg tracking-widest text-hud-dim transition hover:text-hud hover:ring-1 hover:ring-hud/50"
      >
        {paused ? "▶" : "❚❚"}
      </button>
      <span
        className={`rounded-sm border px-2 py-0.5 font-display text-[10px] tracking-[0.2em] ${
          paused
            ? "border-amber-400/60 text-amber-300"
            : "border-hud/40 text-hud-dim"
        }`}
      >
        {paused ? "PAUSED" : "FLIGHT"}
      </span>
    </div>
  );
}
