import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CockpitHUD, type HUDState } from "@/components/CockpitHUD";
import { MobileControls } from "@/components/MobileControls";
import { SpaceScene } from "@/components/SpaceScene";
import { useIsMobile } from "@/hooks/use-mobile";

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new SpaceScene(canvas, {
      onDiscovery: (d) => {
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

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      scene.setMouse(x, y);
      if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (down) {
        if (e.code === "Escape") {
          setHud((s) => ({ ...s, paused: !s.paused }));
          scene.paused = !scene.paused;
          return;
        }
        if (e.code === "Space") {
          e.preventDefault();
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
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    let raf = 0;
    let last = performance.now();
    let objIdx = 0;
    let objSwap = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      scene.update(dt);

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

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      scene.dispose();
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
      <CockpitHUD
        state={hud}
        onResume={() => {
          setHud((s) => ({ ...s, paused: false }));
          if (sceneRef.current) sceneRef.current.paused = false;
        }}
      />
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
