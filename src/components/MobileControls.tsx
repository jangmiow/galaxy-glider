import { useEffect, useRef, useState } from "react";

type Props = {
  onSteer: (x: number, y: number) => void;
  onThrust: (t: number) => void; // -1..1
  onWarp: () => void;
  onPause: () => void;
  warpReady: boolean;
};

export function MobileControls({ onSteer, onThrust, onWarp, onPause, warpReady }: Props) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeId = useRef<number | null>(null);
  const [thrust, setThrust] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Joystick handlers
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;

    const radius = () => pad.clientWidth / 2;

    const update = (clientX: number, clientY: number) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const r = radius();
      const dist = Math.hypot(dx, dy);
      if (dist > r) {
        dx = (dx / dist) * r;
        dy = (dy / dist) * r;
      }
      setKnob({ x: dx, y: dy });
      onSteer(dx / r, dy / r);
    };

    const onStart = (e: PointerEvent) => {
      if (activeId.current !== null) return;
      activeId.current = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      update(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activeId.current) return;
      update(e.clientX, e.clientY);
    };
    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== activeId.current) return;
      activeId.current = null;
      setKnob({ x: 0, y: 0 });
      onSteer(0, 0);
    };

    pad.addEventListener("pointerdown", onStart);
    pad.addEventListener("pointermove", onMove);
    pad.addEventListener("pointerup", onEnd);
    pad.addEventListener("pointercancel", onEnd);
    return () => {
      pad.removeEventListener("pointerdown", onStart);
      pad.removeEventListener("pointermove", onMove);
      pad.removeEventListener("pointerup", onEnd);
      pad.removeEventListener("pointercancel", onEnd);
    };
  }, [onSteer]);

  const handleThrust = (v: number) => {
    setThrust(v);
    onThrust(v);
  };

  return (
    <>
      {/* Best-on-desktop notice */}
      {!dismissed && (
        <div className="pointer-events-auto absolute left-1/2 top-20 z-20 -translate-x-1/2 hud-panel rounded-md px-4 py-2 text-center text-[11px]">
          <div className="text-amber">Best experienced on desktop</div>
          <button
            onClick={() => setDismissed(true)}
            className="mt-1 text-[10px] text-hud-dim underline hover:text-hud"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Joystick (bottom-left) */}
      <div className="pointer-events-auto absolute bottom-28 left-6 z-20">
        <div
          ref={padRef}
          className="relative h-32 w-32 touch-none rounded-full border border-hud/40 bg-background/40 backdrop-blur-sm"
          style={{ boxShadow: "0 0 24px rgba(0, 200, 255, 0.15) inset" }}
        >
          <div className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 -translate-y-1/2 bg-hud/15" />
          <div className="absolute left-1/2 top-1/2 h-full w-px -translate-x-1/2 -translate-y-1/2 bg-hud/15" />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hud bg-hud/30"
            style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
          />
        </div>
        <div className="mt-1 text-center font-display text-[10px] tracking-widest text-hud-dim">STEER</div>
      </div>

      {/* Thrust slider (bottom-right) */}
      <div className="pointer-events-auto absolute bottom-28 right-6 z-20 flex flex-col items-center">
        <div className="relative h-40 w-12 rounded-full border border-hud/40 bg-background/40 backdrop-blur-sm">
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={thrust}
            onChange={(e) => handleThrust(parseFloat(e.target.value))}
            onPointerUp={() => handleThrust(0)}
            onPointerCancel={() => handleThrust(0)}
            className="absolute left-1/2 top-1/2 h-12 w-40 -translate-x-1/2 -translate-y-1/2 -rotate-90 cursor-pointer accent-hud"
            aria-label="Thrust"
          />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-hud/40" />
        </div>
        <div className="mt-1 font-display text-[10px] tracking-widest text-hud-dim">THRUST</div>
      </div>

      {/* Action buttons (bottom-center) */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-3">
        <button
          onClick={onPause}
          className="rounded-md border border-hud/40 bg-background/60 px-4 py-2 font-display text-[11px] tracking-widest text-hud-dim backdrop-blur-sm hover:text-hud"
        >
          PAUSE
        </button>
        <button
          onClick={onWarp}
          disabled={!warpReady}
          className={`rounded-md border px-5 py-2 font-display text-[11px] tracking-widest backdrop-blur-sm ${
            warpReady
              ? "border-amber bg-amber/20 text-amber scan-pulse"
              : "border-hud/30 bg-background/60 text-hud-dim opacity-60"
          }`}
        >
          WARP
        </button>
      </div>
    </>
  );
}
