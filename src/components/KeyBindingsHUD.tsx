import { useEffect, useState } from "react";

/**
 * Desktop-only minimal control map. Three rows: steering keys, the dual-purpose
 * Space bar (boost / warp), and a tiny mouse legend for click-to-fly autopilot.
 *
 * Key caps light up while the corresponding physical key is held so the pilot
 * sees that input is reaching the game. Pure presentational — listens to
 * window keydown/keyup directly to stay decoupled from the scene's input pipe.
 */
export function KeyBindingsHUD() {
  const [pressed, setPressed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const down = (e: KeyboardEvent) =>
      setPressed((s) => {
        if (s.has(e.code)) return s;
        const n = new Set(s);
        n.add(e.code);
        return n;
      });
    const up = (e: KeyboardEvent) =>
      setPressed((s) => {
        if (!s.has(e.code)) return s;
        const n = new Set(s);
        n.delete(e.code);
        return n;
      });
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const isDown = (...codes: string[]) => codes.some((c) => pressed.has(c));

  return (
    <div className="pointer-events-none absolute bottom-6 left-6 z-10 hidden font-display text-hud md:block">
      <div className="rounded border border-hud/40 bg-black/55 p-3 text-[10px] tracking-widest backdrop-blur-sm">
        <div className="mb-2 text-hud/70">CONTROLS</div>

        {/* Steering — WASD / arrows */}
        <div className="mb-2 flex items-center gap-3">
          <div className="grid grid-cols-3 gap-1">
            <span />
            <Key label="W" active={isDown("KeyW", "ArrowUp")} />
            <span />
            <Key label="A" active={isDown("KeyA", "ArrowLeft")} />
            <Key label="S" active={isDown("KeyS", "ArrowDown")} />
            <Key label="D" active={isDown("KeyD", "ArrowRight")} />
          </div>
          <div className="text-hud/60 leading-tight">
            <div>W / S · THRUST</div>
            <div>A / D · STEER</div>
          </div>
        </div>

        {/* Space — boost (tap) / warp (hold) */}
        <div className="mb-2 flex items-center gap-3">
          <Key label="SPACE" wide active={isDown("Space")} />
          <div className="text-hud/60 leading-tight">
            <div>TAP · BOOST</div>
            <div>HOLD · WARP</div>
          </div>
        </div>

        {/* Mouse — click-to-fly autopilot */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <MouseHint label="CLICK" />
            <MouseHint label="2× CLICK" />
            <MouseHint label="RIGHT" />
          </div>
          <div className="text-hud/60 leading-tight">
            <div>CLICK PLANET · APPROACH</div>
            <div>DOUBLE-CLICK · FLYBY</div>
            <div>RIGHT-CLICK · ABORT</div>
          </div>
        </div>

        <div className="mt-2 text-[9px] text-hud/40">ESC · PAUSE</div>
      </div>
    </div>
  );
}

function Key({ label, active, wide }: { label: string; active: boolean; wide?: boolean }) {
  return (
    <div
      className={`flex h-6 items-center justify-center rounded border text-[10px] tracking-widest transition-colors ${
        wide ? "w-20" : "w-6"
      } ${
        active
          ? "border-hud bg-hud/30 text-hud shadow-[0_0_8px_var(--color-hud)]"
          : "border-hud/40 bg-black/40 text-hud/70"
      }`}
    >
      {label}
    </div>
  );
}

function MouseHint({ label }: { label: string }) {
  return (
    <div className="flex h-5 w-20 items-center justify-center rounded border border-hud/40 bg-black/40 text-[9px] tracking-widest text-hud/70">
      {label}
    </div>
  );
}
