import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { HUDState } from "@/components/CockpitHUD";
import type { MinimapData } from "@/components/Minimap";
import { SpaceScene } from "@/components/SpaceScene";
import { CockpitAudio } from "@/lib/audio";
import { OBJECTIVES, OBJECTIVE_TARGET, rankFor } from "@/lib/cockpit";
import { generateName } from "@/lib/journal";
import {
  addMedal,
  getActivePilot,
  loadFlightState,
  loadStats,
  loadSystemSeed,
  saveFlightState,
  saveStats,
  saveSystemSeed,
  type PilotStats,
} from "@/lib/pilots";
import { sectorFor, loadVisited, markVisited } from "@/lib/galaxy";


type SteerInput = (x: number, y: number) => void;
type ThrustInput = (t: number) => void;

export type CockpitController = {
  /** Forwarded to the underlying SpaceScene to nudge mouse-look. */
  steer: SteerInput;
  /** Sets the scene's W/S key state from a virtual joystick, mobile only. */
  thrust: ThrustInput;
  /** Try to engage warp; no-op if not READY. */
  warp: () => void;
  /** Engage warp to a specific target system seed (from the Galaxy Map). */
  warpTo: (seed: number) => void;
  /** Snapshot of seeds the active pilot has visited. */
  visitedSystems: Set<number>;
  /** Current system seed — handy for the Galaxy Map. */
  currentSystemSeed: number;
  /** Fire the 2-second speed burst (Space-tap on desktop, button on mobile). */
  boostBurst: () => void;
  /** Toggle pause both in scene and HUD. */
  togglePause: () => void;
  /** Resume from a paused HUD state. */
  resume: () => void;
  /** Mute/unmute audio. */
  setMuted: (m: boolean) => void;
  muted: boolean;
  /** Toggle the approach autopilot from a UI button (mobile). */
  toggleApproach: () => void;
  /** Toggle the cinematic flyby autopilot. */
  toggleFlyby: () => void;
  /** Universal autopilot abort — kills approach + flyby in one call. */
  abortAutopilot: () => void;
  /** Read current flyby tuning (for the settings panel). */
  getFlybyConfig: () => { altitudeMul: number; offsetMul: number; durationMul: number };
  /** Update flyby tuning (applied to the next engagement). */
  setFlybyConfig: (cfg: Partial<{ altitudeMul: number; offsetMul: number; durationMul: number }>) => void;
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

  // SSR renders before localStorage is available, so we always start with the
  // safe placeholder values and hydrate the real pilot in a post-mount effect
  // below. This avoids "server text didn't match client" hydration errors that
  // would otherwise tear down and re-mount the entire HUD subtree.
  const [hud, setHud] = useState<HUDState>({
    velocity: 0,
    thrust: 0,
    warpCharge: 0,
    warpCooldown: 0,
    isWarping: false,
    nextSystemName: null,
    nextSystemSector: null,
    arriving: false,
    heading: { pitch: 0, yaw: 0 },
    score: 0,
    rank: "CADET",
    callsign: "PILOT",
    objective: OBJECTIVES[0],
    paused: false,
    scanning: null,
    lastDiscovery: null,
    showHints: true,
    medal: null,
    boost: false,
    boostBurst: false,
    boostCooldown: 0,
    boostCooldownMax: 1,
    boostDuration: 2,
    boostRemaining: 0,
    warpHoldProgress: 0,
    proximity: null,
    approach: null,
    framing: null,
    sensorContact: null,
    flyby: null,
    flybyConfig: { altitudeMul: 3, offsetMul: 0, durationMul: 1 },
  });
  const hudRef = useRef(hud);
  hudRef.current = hud;

  // Stable ref to the active pilot id used by score/medal persistence.
  // Populated post-mount in the effect below to keep SSR identical to client.
  const pilotIdRef = useRef<string | null>(null);
  // Set of system seeds the active pilot has visited (for the Galaxy Map).
  const [visitedSystems, setVisitedSystems] = useState<Set<number>>(() => new Set());
  // Tracks the current system seed for the Galaxy Map.
  const [currentSystemSeed, setCurrentSystemSeed] = useState<number>(0);

  // Hydrate pilot identity + persisted stats AFTER mount so the SSR HTML
  // matches the first client render exactly. A microsecond flash from
  // "PILOT/CADET/0" → real values is acceptable; a hydration mismatch is not.
  useEffect(() => {
    const pilot = getActivePilot();
    if (!pilot) return;
    pilotIdRef.current = pilot.id;
    const seedNow = loadSystemSeed(pilot.id) ?? 0;
    const initialVisited = loadVisited(pilot.id);
    initialVisited.add(seedNow);
    markVisited(pilot.id, seedNow);
    setVisitedSystems(initialVisited);
    setCurrentSystemSeed(seedNow);
    const stats = loadStats(pilot.id);
    setHud((s) => ({
      ...s,
      callsign: pilot.callsign,
      score: stats.score,
      rank: stats.rank,
    }));
    // Restore the last system seed the pilot was exploring. Sol (seed 0) is
    // the default, so we only rebuild when a generated system was saved.
    // Note: this runs BEFORE the scene-init effect, so sceneRef may be null;
    // the scene effect re-reads the seed and applies it on construction.
  }, []);

  /**
   * Persist score+rank to the active pilot's stats. Medals are written
   * separately by `addMedal` when a system is fully surveyed.
   */
  const persistScore = (score: number, rank: string) => {
    const id = pilotIdRef.current;
    if (!id) return;
    const stats = loadStats(id);
    saveStats(id, { ...stats, score, rank });
  };

  const [minimap, setMinimap] = useState<MinimapData | null>(null);
  const [muted, setMutedState] = useState(false);
  // Mirror of scene.flybyConfig so the settings panel re-renders on tweaks.
  const [flybyConfig, setFlybyConfigState] = useState({
    altitudeMul: 3,
    offsetMul: 0,
    durationMul: 1,
  });

  // Tracks recently scanned body names → expiry timestamp (ms). The minimap
  // pulses any dot whose name is still in this map, drawing the eye to the
  // freshly catalogued waypoint for a few seconds.
  const freshlyScannedRef = useRef<Map<string, number>>(new Map());
  const FRESH_DURATION_MS = 4800;

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
        // Mark this body as freshly scanned so the minimap can pulse its dot.
        freshlyScannedRef.current.set(d.name, performance.now() + FRESH_DURATION_MS);
        setHud((s) => {
          const score = s.score + 250;
          const rank = rankFor(score);
          persistScore(score, rank);
          return { ...s, score, rank, lastDiscovery: d.name };
        });
        setTimeout(() => setHud((s) => ({ ...s, lastDiscovery: null })), 2500);
      },
      onScanProgress: (info) =>
        setHud((s) => {
          // Fire a one-shot chirp the moment progress crosses into LOCKED,
          // but suppress it for the cyan "already catalogued" hint so we
          // don't ping every time the pilot glances at a known body.
          const wasLocked = (s.scanning?.progress ?? 0) >= 0.999 && !s.scanning?.alreadyScanned;
          const isLocked = (info?.progress ?? 0) >= 0.999 && !info?.alreadyScanned;
          if (isLocked && !wasLocked) audio.lockChirp();
          return { ...s, scanning: info };
        }),
      onOrbCollected: () => {
        audio.orbPing();
        setHud((s) => {
          const score = s.score + 50;
          const rank = rankFor(score);
          persistScore(score, rank);
          return { ...s, score, rank };
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
        // Persist the medal under the active pilot.
        if (pilotIdRef.current) addMedal(pilotIdRef.current, info.systemId);
        setHud((s) => {
          const score = s.score + 1000;
          const rank = rankFor(score);
          persistScore(score, rank);
          return {
            ...s,
            score,
            rank,
            medal: { systemName: info.systemName, bodyCount: info.bodyCount },
          };
        });
        // Clear the medal overlay after the pop animation finishes (4s).
        setTimeout(() => setHud((s) => ({ ...s, medal: null })), 4000);
      },
    });
    sceneRef.current = scene;

    // Restore previously persisted system seed + flight transform for the
    // active pilot. We read directly here (rather than relying on the
    // pilot-hydration effect) because effect order means sceneRef is still
    // null when that runs.
    const pilotForSeed = getActivePilot();
    if (pilotForSeed) {
      const savedSeed = loadSystemSeed(pilotForSeed.id);
      if (savedSeed > 0) {
        scene.systemSeed = savedSeed;
        scene.buildSystem(savedSeed);
      }
      // Apply saved ship transform if it matches the system we just built —
      // otherwise the snapshot is stale (warped to a new system since save).
      const flight = loadFlightState(pilotForSeed.id);
      if (flight && flight.systemSeed === scene.systemSeed) {
        scene.ship.position.set(flight.pos[0], flight.pos[1], flight.pos[2]);
        scene.ship.quaternion.set(flight.quat[0], flight.quat[1], flight.quat[2], flight.quat[3]);
        scene.velocity = flight.velocity;
        toast("RESUMED", { description: "Last position restored", duration: 1800 });
      }
    }
    let lastPersistedSeed = scene.systemSeed;
    // Autosave bookkeeping — flush every 3s OR when the ship has drifted >5u.
    let saveAcc = 0;
    let lastSavedPos = scene.ship.position.clone();
    const flushFlightState = () => {
      const id = pilotIdRef.current;
      if (!id) return;
      const snap = scene.getSnapshot();
      saveFlightState(id, {
        systemSeed: scene.systemSeed,
        pos: snap.pos,
        quat: snap.quat,
        velocity: snap.velocity,
        savedAt: Date.now(),
      });
      lastSavedPos.copy(scene.ship.position);
    };

    const resize = () => {
      scene.resize(canvas.clientWidth, canvas.clientHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    // Audio context can only start after a user gesture; any pointer/key
    // event on the canvas counts.
    const startAudio = () => audio.start();

    const onMove = (e: MouseEvent) => {
      // HUD dead zone: if the cursor is over an element flagged as
      // `data-hud-safe`, freeze steering so reaching for the pause/mute
      // button doesn't yaw the ship.
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (el && el.closest('[data-hud-safe="true"]')) {
        scene.setMouse(0, 0);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      scene.setMouse(x, y);
      startAudio();
      if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
    };

    // SPACE = boost burst (tap). J = lightspeed jump (single press; press
    // again during warp to cancel). Splitting them onto dedicated keys removes
    // the old tap-vs-hold ambiguity and lets the cooldown indicator be a clear
    // "press J when ready" signal.
    const engageWarp = () => {
      if (scene.warpCharge < 1 || scene.isWarping) return;
      audio.warpWhoosh();
      // Compute the destination system name from the seed the scene WILL use
      // when warp completes (current systemSeed + 1 — see SpaceScene.update).
      const destSeed = scene.systemSeed + 1;
      const destName = generateName(destSeed * 1000);
      const destSector = sectorFor(destSeed);
      scene.triggerWarp();
      setHud((s) => ({ ...s, isWarping: true, nextSystemName: destName, nextSystemSector: destSector }));
      // Lightspeed cinematic lasts 3 seconds — single jump to the next system.
      setTimeout(() => {
        setHud((s) => ({ ...s, isWarping: false, nextSystemName: null, nextSystemSector: null, arriving: true }));
        setTimeout(() => setHud((s) => ({ ...s, arriving: false })), 600);
      }, 3000);
    };
    const fireBoostBurst = () => {
      if (scene.triggerBoostBurst()) {
        // Re-use the orb ping as a snappy "engage" cue; cheap and on-brand.
        audio.orbPing();
      }
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
          // OS auto-fires repeat events while held — ignore so the boost only
          // triggers once per physical press.
          if (e.repeat) return;
          fireBoostBurst();
          if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
          return;
        }
        if (e.code === "KeyJ") {
          e.preventDefault();
          if (e.repeat) return;
          // Single dedicated key: engage warp if charged, OR cancel an
          // in-progress jump. No hold gesture, no ambiguity.
          if (scene.isWarping) {
            scene.exitWarp();
            setHud((s) => ({ ...s, isWarping: false, nextSystemName: null, nextSystemSector: null }));
          } else {
            engageWarp();
          }
          if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
          return;
        }
        if (e.code === "Equal" || e.code === "NumpadAdd") {
          adjustRangeRef.current(-1);
        } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
          adjustRangeRef.current(1);
        }
        scene.keys.add(e.code);
        if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
      } else {
        if (e.code === "Space" || e.code === "KeyJ") return;
        scene.keys.delete(e.code);
      }
    };

    // ── Mouse-driven autopilot ────────────────────────────────────────────
    // Single click (left)  → APPROACH the picked body (or nearest if click missed).
    // Double click (left)  → upgrade to FLYBY (cinematic curved pass).
    // Right click anywhere → ABORT all autopilot.
    // Single-click action is debounced so a double-click doesn't fire approach
    // first and then immediately swap to flyby.
    const DOUBLE_MS = 280;
    let pendingClick: ReturnType<typeof setTimeout> | null = null;
    let lastClickAt = 0;
    let lastPick: { id: string; name: string; dist: number } | null = null;

    const ndcFromEvent = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      };
    };

    const doApproach = (target: { id: string; name: string; dist: number } | null) => {
      const t = scene.engageApproach(target?.id);
      if (t) {
        toast("APPROACH ENGAGED", {
          description: `${t.name} · ${t.dist.toFixed(0)}u`,
          duration: 1800,
        });
      } else {
        toast("APPROACH UNAVAILABLE", { description: "No body in range" });
      }
    };

    const doFlyby = (target: { id: string; name: string; dist: number } | null) => {
      const t = scene.engageFlyby(target?.id);
      if (t) {
        toast("FLYBY ENGAGED", {
          description: `${t.name} · altitude ${t.altitude.toFixed(0)}u`,
          duration: 2000,
        });
      } else {
        toast("FLYBY UNAVAILABLE", { description: "No body in range" });
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      startAudio();
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        const wasFlyby = scene.flyby.active;
        const wasApproach = scene.approach.active;
        if (wasFlyby) scene.disengageFlyby();
        if (wasApproach) scene.disengageApproach();
        if (wasFlyby || wasApproach) {
          toast("AUTOPILOT ABORTED", { duration: 1200 });
        }
        return;
      }
      if (e.button !== 0) return;
      if (e.target !== canvas) return;

      const ndc = ndcFromEvent(e);
      const pick = scene.pickBodyAt(ndc.x, ndc.y);
      const now = performance.now();
      const isDouble = now - lastClickAt < DOUBLE_MS;
      lastClickAt = now;

      if (isDouble) {
        if (pendingClick) {
          clearTimeout(pendingClick);
          pendingClick = null;
        }
        doFlyby(pick ?? lastPick);
        lastPick = pick ?? lastPick;
        return;
      }

      lastPick = pick;
      if (pendingClick) clearTimeout(pendingClick);
      pendingClick = setTimeout(() => {
        pendingClick = null;
        doApproach(pick);
      }, DOUBLE_MS);
    };

    const onContextMenu = (e: MouseEvent) => {
      // Right-click is our "abort" gesture; suppress browser menu.
      e.preventDefault();
    };

    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("contextmenu", onContextMenu);
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
        // Charging rate in scene = dt * 0.08 (full charge ≈ 12.5s). Project the
        // remaining cooldown so the HUD can show a clean "X.Xs" countdown.
        warpCooldown: scene.warpCharge >= 1 ? 0 : (1 - scene.warpCharge) / 0.08,
        heading: { pitch: scene.ship.rotation.x, yaw: scene.ship.rotation.y },
        boost: scene.boost > 1,
        boostBurst: scene.boostActive,
        boostCooldown: scene.boostCooldown,
        boostCooldownMax: scene.BOOST_COOLDOWN,
        boostDuration: scene.BOOST_DURATION,
        boostRemaining: scene.boostTimer,
        warpHoldProgress: 0,
        proximity: scene.proximity,
        approach: scene.approach.active && scene.approach.targetName
          ? { target: scene.approach.targetName, distance: scene.approach.distance }
          : null,
        framing: scene.frameTween
          ? {
              target: scene.frameTween.targetName,
              distance: (() => {
                const b = scene.bodies.find((x) => x.id === scene.frameTween!.targetId);
                return b ? b.mesh.position.distanceTo(scene.ship.position) : 0;
              })(),
              progress: scene.frameTween.elapsed / scene.frameTween.duration,
            }
          : null,
        sensorContact: (() => {
          // Passive sensor: nearest uncatalogued, non-star body within 2000u.
          // Signal grows from 0 at the sensor edge to 1 right at the ship,
          // giving the pilot a "warmer / colder" cue without needing to aim.
          const SENSOR_RANGE = 2000;
          let best: { name: string; dist: number } | null = null;
          for (const b of scene.bodies) {
            if (b.scanned || b.isStar) continue;
            const d = b.mesh.position.distanceTo(scene.ship.position);
            if (d > SENSOR_RANGE) continue;
            if (!best || d < best.dist) best = { name: b.name, dist: d };
          }
          return best
            ? { name: best.name, distance: best.dist, signal: 1 - best.dist / SENSOR_RANGE }
            : null;
        })(),
        flyby: scene.flyby.active && scene.flyby.targetName
          ? {
              target: scene.flyby.targetName,
              progress: scene.flyby.elapsed / scene.flyby.duration,
              // Normalize the raw nudge magnitudes to -1..1 for the HUD bar.
              // Scene clamps each axis to ~1.5× target radius; we approximate
              // a unitless 0..1 fill by dividing against the same maxNudge.
              nudgeLateral: Math.max(-1, Math.min(1, scene.flyby.nudgeLateral / 60)),
              nudgeVertical: Math.max(-1, Math.min(1, scene.flyby.nudgeVertical / 60)),
              cursor: { x: scene.mouseX, y: scene.mouseY },
              keys: {
                left: scene.keys.has("KeyA") || scene.keys.has("ArrowLeft"),
                right: scene.keys.has("KeyD") || scene.keys.has("ArrowRight"),
                up: scene.keys.has("KeyW") || scene.keys.has("ArrowUp"),
                down: scene.keys.has("KeyS") || scene.keys.has("ArrowDown"),
              },
            }
          : null,
        flybyConfig: { ...scene.flybyConfig },
      }));

      // Refresh minimap ~10fps to keep allocation pressure low.
      mmAcc += dt;
      if (mmAcc > 0.1) {
        mmAcc = 0;
        const target = OBJECTIVE_TARGET[hudRef.current.objective] ?? null;
        const snap = scene.getMinimapSnapshot(target, minimapRangeRef.current ?? 800);
        // Prune expired fresh-scan entries and forward the live set so the
        // minimap can render a brief pulse ring on each newly catalogued dot.
        const nowMs = performance.now();
        const fresh = freshlyScannedRef.current;
        for (const [name, expiry] of fresh) {
          if (expiry <= nowMs) fresh.delete(name);
        }
        setMinimap({ ...snap, freshlyScanned: new Set(fresh.keys()) });

        // Persist the active system seed when warp lands the pilot in a new
        // generated system. Throttled to the minimap tick (~10fps) so we
        // never write per-frame, and only when the value actually changes.
        if (scene.systemSeed !== lastPersistedSeed && pilotIdRef.current) {
          lastPersistedSeed = scene.systemSeed;
          saveSystemSeed(pilotIdRef.current, scene.systemSeed);
          markVisited(pilotIdRef.current, scene.systemSeed);
          setCurrentSystemSeed(scene.systemSeed);
          setVisitedSystems((prev) => {
            if (prev.has(scene.systemSeed)) return prev;
            const next = new Set(prev);
            next.add(scene.systemSeed);
            return next;
          });
          // Force a flight-state save on system change so the new seed
          // doesn't get paired with a stale position from the prior system.
          flushFlightState();
          saveAcc = 0;
        }
      }

      // Autosave flight transform every ~3s OR when ship has drifted >5u
      // from the last save point. Skip while warping (snapshot would be junk).
      saveAcc += dt;
      if (!scene.isWarping && pilotIdRef.current) {
        const drift = scene.ship.position.distanceTo(lastSavedPos);
        if (saveAcc > 3 || drift > 5) {
          flushFlightState();
          saveAcc = 0;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Flush flight state on tab unload so refresh / close preserves position.
    const onUnload = () => flushFlightState();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("beforeunload", onUnload);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      // Final save on unmount so navigating away (e.g. /journal) preserves state.
      flushFlightState();
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
    // Feed the slider value as a continuous virtual thrust so the lever and
    // velocity ramp smoothly with finger position rather than snapping like a key.
    const clamped = Math.max(-1, Math.min(1, t));
    scene.virtualThrust = Math.abs(clamped) < 0.05 ? 0 : clamped;
    if (hudRef.current.showHints) setHud((s) => ({ ...s, showHints: false }));
  }, []);

  const warp = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene || scene.warpCharge < 1) return;
    audioRef.current?.start();
    audioRef.current?.warpWhoosh();
    const destSeed = scene.systemSeed + 1;
    const destName = generateName(destSeed * 1000);
    const destSector = sectorFor(destSeed);
    scene.triggerWarp();
    setHud((s) => ({ ...s, isWarping: true, nextSystemName: destName, nextSystemSector: destSector }));
    setTimeout(() => {
      setHud((s) => ({ ...s, isWarping: false, nextSystemName: null, nextSystemSector: null, arriving: true }));
      setTimeout(() => setHud((s) => ({ ...s, arriving: false })), 600);
    }, 3000);
  }, []);

  const boostBurst = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    audioRef.current?.start();
    if (scene.triggerBoostBurst()) audioRef.current?.orbPing();
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

  const toggleApproach = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.approach.active) {
      scene.disengageApproach();
      toast("APPROACH DISENGAGED");
    } else {
      const target = scene.engageApproach();
      if (target) {
        toast("APPROACH ENGAGED", {
          description: `${target.name} · ${target.dist.toFixed(0)}u`,
          duration: 1800,
        });
      } else {
        toast("APPROACH UNAVAILABLE", { description: "No unscanned body in range" });
      }
    }
  }, []);

  const toggleFlyby = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.flyby.active) {
      scene.disengageFlyby();
      toast("FLYBY DISENGAGED");
    } else {
      const t = scene.engageFlyby();
      if (t) {
        toast("FLYBY ENGAGED", {
          description: `${t.name} · altitude ${t.altitude.toFixed(0)}u`,
          duration: 2000,
        });
      } else {
        toast("FLYBY UNAVAILABLE", { description: "No body in range" });
      }
    }
  }, []);

  const getFlybyConfig = useCallback(() => flybyConfig, [flybyConfig]);
  const setFlybyConfig = useCallback(
    (cfg: Partial<{ altitudeMul: number; offsetMul: number; durationMul: number }>) => {
      const scene = sceneRef.current;
      const L = SpaceScene.FLYBY_LIMITS;
      const clamp = (v: number, lim: { min: number; max: number }) =>
        Math.max(lim.min, Math.min(lim.max, Math.round(v * 100) / 100));
      setFlybyConfigState((prev) => {
        const next = {
          altitudeMul: clamp(cfg.altitudeMul ?? prev.altitudeMul, L.altitudeMul),
          offsetMul: clamp(cfg.offsetMul ?? prev.offsetMul, L.offsetMul),
          durationMul: clamp(cfg.durationMul ?? prev.durationMul, L.durationMul),
        };
        if (scene) scene.flybyConfig = next;
        return next;
      });
    },
    [],
  );

  const abortAutopilot = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const wasFlyby = scene.flyby.active;
    const wasApproach = scene.approach.active;
    if (wasFlyby) scene.disengageFlyby();
    if (wasApproach) scene.disengageApproach();
    if (wasFlyby || wasApproach) {
      toast("AUTOPILOT ABORTED", {
        description: wasFlyby && wasApproach
          ? "all systems disengaged"
          : wasFlyby ? "flyby disengaged" : "approach disengaged",
        duration: 1200,
      });
    }
  }, []);

  const controller: CockpitController = {
    steer,
    thrust,
    warp,
    boostBurst,
    togglePause,
    resume,
    setMuted,
    muted,
    toggleApproach,
    toggleFlyby,
    abortAutopilot,
    getFlybyConfig,
    setFlybyConfig,
  };

  return { hud, minimap, controller };
}
