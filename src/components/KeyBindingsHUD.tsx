import { useEffect, useState } from "react";

/**
 * Desktop-only cockpit "control map" HUD. Shows the keyboard bindings for
 * thrust (W/S or ↑/↓), yaw/pitch (A/D/←/→ for yaw, W/S/↑/↓ already cover
 * pitch via the same axis pair on most flight sims — here we surface the
 * exact mapping the SpaceScene listens for) and boost (Space tap / hold).
 *
 * Each key cap lights up while the corresponding physical key is held,
 * giving the pilot immediate feedback that input is reaching the game.
 *
 * Pure presentational component — listens to window keydown/keyup directly
 * so it stays decoupled from the scene's input pipeline.
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
        <div className="mb-2 text-hud/70">CONTROL MAP</div>

        {/* Pitch / Yaw cluster — arranged like a directional pad */}
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
            <div>W/S · THRUST</div>
            <div>A/D · YAW</div>
            <div className="text-hud/40">↑↓←→ ALT</div>
          </div>
        </div>

        {/* Cinematic framing: Q/E roll, F frame, G approach autopilot */}
        <div className="mb-2 flex items-center gap-3">
          <div className="flex gap-1">
            <Key label="Q" active={isDown("KeyQ")} />
            <Key label="E" active={isDown("KeyE")} />
            <Key label="F" active={isDown("KeyF")} />
            <Key label="G" active={isDown("KeyG")} />
            <Key label="H" active={isDown("KeyH")} />
          </div>
          <div className="text-hud/60 leading-tight">
            <div>Q/E · ROLL · F · FRAME</div>
            <div>G · APPROACH · H · FLYBY</div>
          </div>
        </div>

        {/* Flyby tuning hotkeys */}
        <div className="mb-2 flex items-center gap-3">
          <div className="flex gap-1">
            <Key label="[" active={isDown("BracketLeft")} />
            <Key label="]" active={isDown("BracketRight")} />
            <Key label=";" active={isDown("Semicolon")} />
            <Key label="'" active={isDown("Quote")} />
            <Key label="," active={isDown("Comma")} />
            <Key label="." active={isDown("Period")} />
          </div>
          <div className="text-hud/60 leading-tight">
            <div>[ ] · ALT · ; ' · OFFSET</div>
            <div>, . · DURATION (next flyby)</div>
          </div>
        </div>

        {/* Boost / Warp on the spacebar */}
        <div className="flex items-center gap-3">
          <Key label="SPACE" wide active={isDown("Space")} />
          <div className="text-hud/60 leading-tight">
            <div>TAP · BOOST</div>
            <div>HOLD · WARP</div>
          </div>
        </div>
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
