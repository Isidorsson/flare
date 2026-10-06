import { useMemo, useSyncExternalStore } from "react";

import { buildHeatView, type HeatView } from "./heat";
import { LIVE } from "./timing";
import { useLive } from "./use-live";

const REPAINT_MS = LIVE.heat.repaintMs;

function subscribeToRepaints(onRepaint: () => void): () => void {
  const timer = window.setInterval(onRepaint, REPAINT_MS);
  return () => {
    window.clearInterval(timer);
  };
}

function ignoreRepaints(): () => void {
  return () => undefined;
}

// The time in whole repaint periods, so the heat is recomputed once per period however often the view renders.
function currentPeriodStart(): number {
  return Math.floor(Date.now() / REPAINT_MS) * REPAINT_MS;
}

/** What is hot in the file tree and the tabs, recomputed every ten seconds while anything is. */
export function useHeatView(): HeatView {
  const touches = useLive((state) => state.touches);
  const anyTouched = Object.keys(touches).length > 0;
  const now = useSyncExternalStore(anyTouched ? subscribeToRepaints : ignoreRepaints, currentPeriodStart);
  return useMemo(() => buildHeatView(touches, now), [touches, now]);
}
