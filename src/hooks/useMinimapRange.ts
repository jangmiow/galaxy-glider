import { useCallback, useRef, useState } from "react";
import { DEFAULT_RANGE, RANGE_STEPS } from "@/lib/cockpit";

/**
 * Tracks the minimap range as a discrete step from RANGE_STEPS and exposes a
 * direction-based adjuster. A ref mirror is included so non-React code (the
 * raf loop) can read the latest value without re-subscribing.
 */
export function useMinimapRange(initial: number = DEFAULT_RANGE) {
  const [range, setRange] = useState<number>(initial);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const adjustRange = useCallback((dir: 1 | -1) => {
    setRange((r) => {
      const idx = RANGE_STEPS.indexOf(r as (typeof RANGE_STEPS)[number]);
      const cur = idx === -1 ? 2 : idx;
      const next = Math.max(0, Math.min(RANGE_STEPS.length - 1, cur + dir));
      return RANGE_STEPS[next];
    });
  }, []);

  return { range, rangeRef, adjustRange };
}
