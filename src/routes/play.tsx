import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef } from "react";
import { CockpitHUD } from "@/components/CockpitHUD";
import { KeyBindingsHUD } from "@/components/KeyBindingsHUD";
import { Minimap } from "@/components/Minimap";
import { MobileControls } from "@/components/MobileControls";
import { MuteButton } from "@/components/MuteButton";
import { PauseButton } from "@/components/PauseButton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMinimapRange } from "@/hooks/useMinimapRange";
import { useSpaceScene } from "@/hooks/useSpaceScene";
import { getActivePilotId, isUnlocked } from "@/lib/pilots";

export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Flight Deck — Cosmic Drift" },
      {
        name: "description",
        content: "Pilot your starship through the galaxy in this first-person space cockpit experience.",
      },
      { property: "og:title", content: "Flight Deck — Cosmic Drift" },
      { property: "og:description", content: "Pilot your starship through the galaxy." },
    ],
  }),
  // Redirect to the home gate if the player skipped the pilot picker.
  // beforeLoad runs on both server and client; only check on the client to
  // avoid SSR localStorage access.
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (!isUnlocked() || !getActivePilotId()) {
      throw redirect({ to: "/" });
    }
  },
  component: Play,
});

function Play() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMobile = useIsMobile();
  const { rangeRef, adjustRange } = useMinimapRange();
  const { hud, minimap, controller } = useSpaceScene(canvasRef, rangeRef, adjustRange);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* Canvas + boost FX layer. The wrapper handles screen-shake so HUD
          chrome (minimap, panels) stays steady while the world jitters. */}
      <div className={`absolute inset-0 ${hud.boostBurst ? "boost-shake" : ""} ${hud.arriving ? "arrival-shake" : ""}`}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-crosshair" />
        {hud.boostBurst && (
          <>
            {/* Chromatic aberration: red on the left edge, cyan on the right. */}
            <div className="ca-overlay ca-red" aria-hidden />
            <div className="ca-overlay ca-cyan" aria-hidden />
            {/* Speed-tunnel vignette. */}
            <div className="boost-vignette" aria-hidden />
            {/* Radial speed-line burst from screen center, fades over 400ms. */}
            <div className="boost-speedlines" aria-hidden />
          </>
        )}
        {hud.arriving && <div className="arrival-flash" aria-hidden />}
      </div>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)" }}
        aria-hidden
      />

      <div
        data-hud-safe="true"
        className="pointer-events-auto absolute bottom-32 right-6 z-10 font-display text-hud"
      >
        <Minimap
          data={minimap}
          objective={hud.objective}
          onZoomIn={() => adjustRange(-1)}
          onZoomOut={() => adjustRange(1)}
        />
      </div>

      <MuteButton muted={controller.muted} onToggle={() => controller.setMuted(!controller.muted)} />
      <PauseButton paused={hud.paused} onToggle={controller.togglePause} />

      <CockpitHUD
        state={hud}
        onResume={controller.resume}
        onFlybyConfigChange={controller.setFlybyConfig}
      />

      {!isMobile && <KeyBindingsHUD hud={hud} />}

      {isMobile && (
        <MobileControls
          warpReady={hud.warpCharge >= 1}
          approachActive={!!hud.approach}
          flybyActive={!!hud.flyby}
          onSteer={controller.steer}
          onThrust={controller.thrust}
          onWarp={controller.warp}
          onBoost={controller.boostBurst}
          onPause={controller.togglePause}
          onApproach={controller.toggleApproach}
          onFlyby={controller.toggleFlyby}
          onAbort={controller.abortAutopilot}
        />
      )}
    </div>
  );
}
