import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { HUDState } from "@/components/CockpitHUD";
import type { MinimapData } from "@/components/Minimap";
import { SpaceScene } from "@/components/SpaceScene";
import { CockpitAudio } from "@/lib/audio";
import { OBJECTIVES, OBJECTIVE_TARGET, rankFor } from "@/lib/cockpit";

type SteerInput = (x: number, y: number) => void;
type ThrustInput = (t: number) => void;

export type CockpitController = {
  /** Forwarded to the underlying SpaceScene to nudge mouse-look. */
  steer: SteerInput;
  /** Sets the scene's W/S key state from a virtual joystick, mobile only. */
  thrust: ThrustInput;
  /** Try to engage warp; no-op if not READY. */
  warp: () => void;
  /** Toggle pause both in scene and HUD. */
  togglePause: () => void;
  /** Resume from a paused HUD state. */
  resume: () => void;
  /** Mute/unmute audio. */
  setMuted: (m: boolean) => void;
  muted: boolean;
};

/**
 * Owns the canvas/scene/audio lifecycle and feeds React with HUD + minimap
 * snapshots ~10–15 fps. The route component renders the visuals; this hook
 * handles every piece of imperative wiring (listeners, raf loop, cleanups).
 */
export function useSpaceScene(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  minimapRangeRef: React.RefObject<number>,
  adjustRange: (dir: 1 | -1) => void,
) {
  const sceneRef = useRef<SpaceScene | null>(null);
  const audioRef = useRef<CockpitAudio | null>(null);

  const [hud, setHud] = useState<HUDState>({
    velocity: 0,
    thrust: 0,
    warpCharge: 0,
    isWarping: false,
    heading: { pitch: 0, yaw: 0 },
    score: 0,
    rank: "CADET",
    objective: OBJECTIVES[0],
    paused: false,
    scanning: null,
    lastDiscovery: null,
    showHints: true,
    medal: null,
    boost: false,
  });
  const hudRef = useRef(hud);
  hudRef.current = hud;

  const [minimap, setMinimap] = useState<MinimapData | null>(null);
  const [muted, setMutedState] = useState(false);

  // Stable ref to adjustRange so the keydown handler doesn't re-bind when the
  // setter identity changes between renders.
  const adjustRangeRef = useRef(adjustRange);
  adjustRangeRef.current = adjustRange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const audio = new CockpitAudio();
    audioRef.current = audio;

    const scene = new SpaceScene(canvas, {
      onDiscovery: (d) => {
        audio.discoveryBeep();
        setHud((s) => {
          const score = s.score + 250;
          return { ...s, score, rank: rankFor(score), lastDiscovery: d.name };
        });
        setTimeout(() => setHud((s) => ({ ...s, lastDiscovery: null })), 2500);
      },
      onScanProgress: (info) =>
        setHud((s) => {
          // Fire a one-shot chirp the moment progress crosses into LOCKED.
          const wasLocked = (s.scanning?.progress ?? 0) >= 0.999;
          const isLocked = (info?.progress ?? 0) >= 0.999;
          if (isLocked && !wasLocked) audio.lockChirp();
          return { ...s, scanning: info };
        }),
      onOrbCollected: () => {
        audio.orbPing();
        setHud((s) => {
          const score = s.score + 50;
          return { ...s, score, rank: rankFor(score) };
        });
      },
      onSystemComplete: (info) => {
        // Reuse the lock chirp + a follow-up discovery beep so the moment
        // sounds bigger than a single body scan without any new audio assets.
        audio.lockChirp();
        setTimeout(() => audio.discoveryBeep(), 220);
        toast(`SYSTEM SURVEYED · ${info.systemName}`, {
          description: `All ${info.bodyCount} bodies catalogued. +1000 bonus.`,
          duration: 4000,
        });
        setHud((s) => {
          const score = s.score + 1000;
          return {
            ...s,
            score,
            rank: rankFor(score),
            medal: { systemName: info.systemName, bodyCount: info.bodyCount },
          };
        });
        // Clear the medal overlay after the pop animation finishes (4s).
        setTimeout(() => setHud((s) => ({ ...s, medal: null })), 4000);
      },
    });
    sceneRef.current = scene;

    const resize = () => {
      scene.resize(canvas.clientWidth, canvas.clientHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    // Audio context can only start after a user gesture; any pointer/key
    // event on the canvas counts.
    const startAudio = () => audio.start();

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      scene.setMouse(x, y);
      startAudio();
      if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
    };

    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (down) {
        startAudio();
        if (e.code === "Escape") {
          setHud((s) => ({ ...s, paused: !s.paused }));
          scene.paused = !scene.paused;
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
          if (scene.warpCharge >= 1 && !scene.isWarping) audio.warpWhoosh();
          scene.triggerWarp();
          setHud((s) => ({ ...s, isWarping: true }));
          setTimeout(() => setHud((s) => ({ ...s, isWarping: false })), 2500);
        }
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          adjustRangeRef.current(-1);
        } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
          adjustRangeRef.current(1);
        } else if (e.code === "KeyT") {
          // Debug: auto-aim at the nearest unscanned body so the lock-on
          // reticle can be triggered without manual mouse-look.
          const target = scene.aimAtNearestBody();
          toast("AUTO-AIM ENGAGED", {
            description: target ? `Locking ${target.name} · ${target.dist.toFixed(0)}u` : "No target in range",
            duration: 1500,
          });
        }
        scene.keys.add(e.code);
        if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
      } else {
        scene.keys.delete(e.code);
      }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("pointerdown", startAudio);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    let raf = 0;
    let last = performance.now();
    let objIdx = 0;
    let objSwap = 0;
    let mmAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      scene.update(dt);

      // Drive engine hum from scene state.
      audio.setThrust(scene.thrust, scene.boost);

      // Rotate objective every 25s.
      objSwap += dt;
      if (objSwap > 25) {
        objSwap = 0;
        objIdx = (objIdx + 1) % OBJECTIVES.length;
        setHud((s) => ({ ...s, objective: OBJECTIVES[objIdx] }));
      }

      // Push numeric HUD state every frame; React batches the setHud calls.
      setHud((s) => ({
        ...s,
        velocity: Math.abs(scene.velocity),
        thrust: scene.thrust,
        warpCharge: scene.warpCharge,
        heading: { pitch: scene.ship.rotation.x, yaw: scene.ship.rotation.y },
        boost: scene.boost > 1,
      }));

      // Refresh minimap ~10fps to keep allocation pressure low.
      mmAcc += dt;
      if (mmAcc > 0.1) {
        mmAcc = 0;
        const target = OBJECTIVE_TARGET[hudRef.current.objective] ?? null;
        setMinimap(scene.getMinimapSnapshot(target, minimapRangeRef.current ?? 800));
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("pointerdown", startAudio);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      scene.dispose();
      audio.dispose();
      audioRef.current = null;
      sceneRef.current = null;
    };
    // canvasRef + minimapRangeRef are stable refs, hook intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Imperative API surfaced to the route for mobile controls / UI buttons ──
  const steer = useCallback<SteerInput>((x, y) => {
    sceneRef.current?.setMouse(x, y);
    if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
  }, []);

  const thrust = useCallback<ThrustInput>((t) => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.keys.delete("KeyW");
    scene.keys.delete("KeyS");
    if (t > 0.05) scene.keys.add("KeyW");
    else if (t < -0.05) scene.keys.add("KeyS");
    if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
  }, []);

  const warp = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || scene.warpCharge < 1) return;
    audioRef.current?.start();
    audioRef.current?.warpWhoosh();
    scene.triggerWarp();
    setHud((s) => ({ ...s, isWarping: true }));
    setTimeout(() => setHud((s) => ({ ...s, isWarping: false })), 2500);
  }, []);

  const togglePause = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.paused = !scene.paused;
    setHud((s) => ({ ...s, paused: scene.paused }));
  }, []);

  const resume = useCallback(() => {
    setHud((s) => ({ ...s, paused: false }));
    if (sceneRef.current) sceneRef.current.paused = false;
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    audioRef.current?.start();
    audioRef.current?.setMuted(m);
  }, []);

  const controller: CockpitController = {
    steer,
    thrust,
    warp,
    togglePause,
    resume,
    setMuted,
    muted,
  };

  return { hud, minimap, controller };
}
