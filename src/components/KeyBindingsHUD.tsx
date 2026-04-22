import { useEffect, useState } from "react";
import type { HUDState } from "@/components/CockpitHUD";

/**
 * Compact in-game "active controls" HUD. Lives bottom-left and condenses the
 * five things the pilot actually needs at a glance:
 *   STEER · BOOST/WARP · FLYBY (click gesture) · ABORT (right-click) · PAUSE
 *
 * Each row is a key-cap (or mouse-cap) on the left + a one-word verb on the
 * right. Caps glow when the corresponding input is currently held, and the
 * whole row dims/highlights based on autopilot state — e.g. once a flyby is
 * engaged the FLYBY row dims to "ENGAGED" and the ABORT row pulses to draw
 * the eye toward the right-click escape hatch.
 *
 * Listens to window keydown/keyup directly so it stays decoupled from the
 * scene's input pipeline.
 */
export function KeyBindingsHUD({ hud }: { hud: HUDState }) {
  const [pressed, setPressed] = useState<Set<string>>(new Set());
  const [mouseDown, setMouseDown] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

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
    const md = (e: MouseEvent) => {
      if (e.button === 0) setMouseDown((s) => ({ ...s, left: true }));
      else if (e.button === 2) setMouseDown((s) => ({ ...s, right: true }));
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) setMouseDown((s) => ({ ...s, left: false }));
      else if (e.button === 2) setMouseDown((s) => ({ ...s, right: false }));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
    };
  }, []);

  const isDown = (...codes: string[]) => codes.some((c) => pressed.has(c));

  // Derive autopilot state for status labels and emphasis.
  const approach = !!hud.approach;
  const flyby = !!hud.flyby;
  const autopilotActive = approach || flyby;
  const warpReady = hud.warpCharge >= 1;

  const steerActive =
    isDown("KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight");

  return (
    <div className="pointer-events-none absolute bottom-6 left-6 z-10 hidden font-display text-hud md:block">
      <div className="rounded border border-hud/40 bg-black/55 p-3 text-[10px] tracking-widest backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between gap-3 text-hud/70">
          <span>CONTROLS</span>
          <span
            className={`text-[9px] ${
              autopilotActive ? "text-amber" : "text-hud/40"
            }`}
          >
            {flyby ? "FLYBY" : approach ? "APPROACH" : "MANUAL"}
          </span>
        </div>

        {/* STEER — WASD/arrows. Glows while any direction is held. */}
        <ControlRow
          caps={
            <div className="grid grid-cols-3 gap-0.5">
              <span />
              <Cap label="W" active={isDown("KeyW", "ArrowUp")} />
              <span />
              <Cap label="A" active={isDown("KeyA", "ArrowLeft")} />
              <Cap label="S" active={isDown("KeyS", "ArrowDown")} />
              <Cap label="D" active={isDown("KeyD", "ArrowRight")} />
            </div>
          }
          label="STEER"
          hint={autopilotActive ? "nudges curve" : "fly the ship"}
          active={steerActive}
        />

        {/* BOOST — Space (tap). */}
        <ControlRow
          caps={<Cap label="SPACE" wide active={isDown("Space")} />}
          label="BOOST"
          hint="2-second burst"
          active={isDown("Space") || hud.boost}
        />

        {/* WARP / lightspeed — dedicated J key with explicit cooldown.
            Label flips between "X.Xs" cooldown, "READY", and "JUMPING" so the
            pilot can time the press without leaning on the hold-gesture. */}
        <ControlRow
          caps={<Cap label="J" active={isDown("KeyJ") || warpReady || hud.isWarping} accent={warpReady || hud.isWarping ? "amber" : undefined} />}
          label={hud.isWarping ? "JUMPING" : warpReady ? "WARP READY" : "WARP"}
          hint={hud.isWarping ? "press to cancel" : warpReady ? "press to engage" : `${hud.warpCooldown.toFixed(1)}s cooldown`}
          active={isDown("KeyJ") || warpReady || hud.isWarping}
          accent={hud.isWarping || warpReady ? "amber" : undefined}
          pulse={warpReady && !hud.isWarping}
        />

        {/* FLYBY click gesture — left-click = approach, double-click = flyby. */}
        <ControlRow
          caps={<MouseCap label="2× CLICK" active={mouseDown.left} />}
          label={flyby ? "FLYBY ENGAGED" : "FLYBY"}
          hint={flyby ? `${Math.round(hud.flyby!.progress * 100)}%` : "double-click planet"}
          active={mouseDown.left || flyby}
          accent={flyby ? "amber" : undefined}
          dim={flyby}
        />

        {/* APPROACH single-click — surfaced when nothing is engaged so new
            pilots learn the gesture; collapses into a hint when active. */}
        <ControlRow
          caps={<MouseCap label="CLICK" active={mouseDown.left && !flyby} />}
          label={approach ? "APPROACHING" : "APPROACH"}
          hint={approach ? hud.approach!.target : "click planet"}
          active={mouseDown.left || approach}
          accent={approach ? "hud" : undefined}
          dim={approach}
        />

        {/* ABORT — right-click. Pulses while autopilot is active to draw the
            eye toward the escape hatch. */}
        <ControlRow
          caps={<MouseCap label="RIGHT" active={mouseDown.right} />}
          label="ABORT"
          hint={autopilotActive ? "kills autopilot" : "—"}
          active={mouseDown.right}
          accent={autopilotActive ? "amber" : undefined}
          pulse={autopilotActive}
          dim={!autopilotActive}
        />

        {/* PAUSE — ESC. */}
        <ControlRow
          caps={<Cap label="ESC" active={isDown("Escape")} />}
          label={hud.paused ? "PAUSED" : "PAUSE"}
          hint="full controls"
          active={isDown("Escape") || hud.paused}
        />
      </div>
    </div>
  );
}

/**
 * Single row of the compact HUD: cap(s) on the left, label + hint on the right.
 * `accent` swaps the row's emphasis color (default hud cyan, "amber" for
 * autopilot/warp states). `dim` lightly fades inactive rows so engaged states
 * stand out, and `pulse` adds a soft attention pulse to the abort row.
 */
function ControlRow({
  caps,
  label,
  hint,
  active,
  accent = "hud",
  dim = false,
  pulse = false,
}: {
  caps: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  accent?: "hud" | "amber";
  dim?: boolean;
  pulse?: boolean;
}) {
  const accentClass = accent === "amber" ? "text-amber" : "text-hud";
  return (
    <div
      className={`mt-1.5 flex items-center gap-2 ${dim ? "opacity-70" : ""} ${
        pulse ? "animate-pulse" : ""
      }`}
    >
      <div className="w-[60px]">{caps}</div>
      <div className="leading-tight">
        <div className={`text-[10px] ${active ? accentClass : "text-hud/70"}`}>{label}</div>
        <div className="text-[9px] text-hud/40">{hint}</div>
      </div>
    </div>
  );
}

function Cap({
  label,
  active,
  wide,
  accent = "hud",
}: {
  label: string;
  active: boolean;
  wide?: boolean;
  accent?: "hud" | "amber";
}) {
  const activeClass =
    accent === "amber"
      ? "border-amber bg-amber/30 text-amber shadow-[0_0_8px_var(--color-amber)]"
      : "border-hud bg-hud/30 text-hud shadow-[0_0_8px_var(--color-hud)]";
  return (
    <div
      className={`flex h-5 items-center justify-center rounded border text-[9px] tracking-widest transition-colors ${
        wide ? "w-[60px]" : "w-5"
      } ${active ? activeClass : "border-hud/40 bg-black/40 text-hud/70"}`}
    >
      {label}
    </div>
  );
}

function MouseCap({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={`flex h-5 w-[60px] items-center justify-center rounded border text-[8px] tracking-widest transition-colors ${
        active
          ? "border-amber bg-amber/30 text-amber shadow-[0_0_8px_var(--color-amber)]"
          : "border-hud/40 bg-black/40 text-hud/70"
      }`}
    >
      {label}
    </div>
  );
}
