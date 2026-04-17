import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CockpitHUD, type HUDState } from "@/components/CockpitHUD";
import { Minimap, type MinimapData } from "@/components/Minimap";
import { MobileControls } from "@/components/MobileControls";
import { SpaceScene } from "@/components/SpaceScene";
import { CockpitAudio } from "@/lib/audio";
import type { Discovery } from "@/lib/journal";
import { useIsMobile } from "@/hooks/use-mobile";

const OBJECTIVE_TARGET: Record<string, Discovery["type"] | "orb" | null> = {
  "Discover 3 new worlds": "planet",
  "Reach a blue giant star": "blue-giant",
  "Collect 5 energy orbs": "orb",
  "Engage lightspeed": null,
  "Discover a ringed planet": "ringed-planet",
};

export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Flight Deck — Cosmic Drift" },
      { name: "description", content: "Pilot your starship through the galaxy in this first-person space cockpit experience." },
      { property: "og:title", content: "Flight Deck — Cosmic Drift" },
      { property: "og:description", content: "Pilot your starship through the galaxy." },
    ],
  }),
  component: Play,
});

const OBJECTIVES = [
  "Discover 3 new worlds",
  "Reach a blue giant star",
  "Collect 5 energy orbs",
  "Engage lightspeed",
  "Discover a ringed planet",
];

function Play() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const isMobile = useIsMobile();
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
  });
  const hudRef = useRef(hud);
  hudRef.current = hud;
  const [minimap, setMinimap] = useState<MinimapData | null>(null);
  const audioRef = useRef<CockpitAudio | null>(null);
  const [muted, setMuted] = useState(false);

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
          return {
            ...s,
            score,
            rank: rankFor(score),
            lastDiscovery: d.name,
          };
        });
        setTimeout(() => setHud((s) => ({ ...s, lastDiscovery: null })), 2500);
      },
      onScanProgress: (info) => setHud((s) => ({ ...s, scanning: info })),
      onOrbCollected: () => {
        audio.orbPing();
        setHud((s) => {
          const score = s.score + 50;
          return { ...s, score, rank: rankFor(score) };
        });
      },
    });
    sceneRef.current = scene;

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      scene.resize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

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

      // Drive engine hum from scene state
      audio.setThrust(scene.thrust, scene.boost);

      // Rotate objective every 25s
      objSwap += dt;
      if (objSwap > 25) {
        objSwap = 0;
        objIdx = (objIdx + 1) % OBJECTIVES.length;
        setHud((s) => ({ ...s, objective: OBJECTIVES[objIdx] }));
      }

      // Push numeric HUD state ~15fps
      setHud((s) => ({
        ...s,
        velocity: Math.abs(scene.velocity),
        thrust: scene.thrust,
        warpCharge: scene.warpCharge,
        heading: { pitch: scene.ship.rotation.x, yaw: scene.ship.rotation.y },
      }));

      // Refresh minimap ~10fps
      mmAcc += dt;
      if (mmAcc > 0.1) {
        mmAcc = 0;
        const target = OBJECTIVE_TARGET[hudRef.current.objective] ?? null;
        setMinimap(scene.getMinimapSnapshot(target));
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
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-crosshair" />
      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)" }}
        aria-hidden
      />
      {/* Star map / minimap */}
      <div className="pointer-events-none absolute bottom-32 right-6 z-10 font-display text-hud">
        <Minimap data={minimap} objective={hud.objective} />
      </div>
      {/* Mute toggle */}
      <button
        onClick={() => {
          const next = !muted;
          setMuted(next);
          audioRef.current?.start();
          audioRef.current?.setMuted(next);
        }}
        className="hud-panel pointer-events-auto absolute bottom-6 right-[260px] z-10 rounded-md px-3 py-2 font-display text-xs tracking-widest text-hud-dim hover:text-hud"
        aria-label={muted ? "Unmute audio" : "Mute audio"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? "🔇 SOUND OFF" : "🔊 SOUND ON"}
      </button>
      <CockpitHUD
        state={hud}
        onResume={() => {
          setHud((s) => ({ ...s, paused: false }));
          if (sceneRef.current) sceneRef.current.paused = false;
        }}
      />
      {isMobile && (
        <MobileControls
          warpReady={hud.warpCharge >= 1}
          onSteer={(x, y) => {
            sceneRef.current?.setMouse(x, y);
            if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
          }}
          onThrust={(t) => {
            const scene = sceneRef.current;
            if (!scene) return;
            scene.keys.delete("KeyW");
            scene.keys.delete("KeyS");
            if (t > 0.05) scene.keys.add("KeyW");
            else if (t < -0.05) scene.keys.add("KeyS");
            if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
          }}
          onWarp={() => {
            const scene = sceneRef.current;
            if (!scene || scene.warpCharge < 1) return;
            audioRef.current?.start();
            audioRef.current?.warpWhoosh();
            scene.triggerWarp();
            setHud((s) => ({ ...s, isWarping: true }));
            setTimeout(() => setHud((s) => ({ ...s, isWarping: false })), 2500);
          }}
          onPause={() => {
            const scene = sceneRef.current;
            if (!scene) return;
            scene.paused = !scene.paused;
            setHud((s) => ({ ...s, paused: scene.paused }));
          }}
        />
      )}
    </div>
  );
}

function rankFor(score: number): string {
  if (score >= 5000) return "COMMANDER";
  if (score >= 2500) return "CAPTAIN";
  if (score >= 1000) return "PILOT";
  if (score >= 250) return "ENSIGN";
  return "CADET";
}
