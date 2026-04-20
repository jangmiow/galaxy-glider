type Props = {
  muted: boolean;
  onToggle: () => void;
};

/** Small HUD-styled audio mute toggle pinned to the bottom-right area. */
export function MuteButton({ muted, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="hud-panel pointer-events-auto absolute bottom-6 right-[260px] z-10 rounded-md px-3 py-2 font-display text-xs tracking-widest text-hud-dim hover:text-hud"
      aria-label={muted ? "Unmute audio" : "Mute audio"}
      title={muted ? "Unmute" : "Mute"}
    >
      {muted ? "🔇 SOUND OFF" : "🔊 SOUND ON"}
    </button>
  );
}
