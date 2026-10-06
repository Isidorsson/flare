import forceAtlas2 from "graphology-layout-forceatlas2";

import type { CodeGraph } from "./graph-model";

export const MIN_LAYOUT_ITERATIONS = 120;
export const MAX_LAYOUT_ITERATIONS = 600;
const LAYOUT_WORK_BUDGET = 60_000;
const STEP_ITERATIONS = 4;
const FRAME_BUDGET_MS = 10;
const MIN_NODES_TO_LAYOUT = 2;

export interface LayoutScheduler {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

export const browserScheduler: LayoutScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  now: () => performance.now(),
};

export interface LayoutOptions {
  iterations: number;
  animate: boolean;
  onFrame: () => void;
  onDone: () => void;
  scheduler: LayoutScheduler;
}

export interface LayoutRun {
  cancel: () => void;
}

export function layoutIterations(order: number): number {
  const scaled = Math.round(LAYOUT_WORK_BUDGET / Math.max(order, 1));
  return Math.min(MAX_LAYOUT_ITERATIONS, Math.max(MIN_LAYOUT_ITERATIONS, scaled));
}

export function startLayout(graph: CodeGraph, options: LayoutOptions): LayoutRun {
  const { scheduler, iterations } = options;
  if (graph.order < MIN_NODES_TO_LAYOUT || iterations <= 0) {
    options.onDone();
    return { cancel: () => undefined };
  }
  const settings = forceAtlas2.inferSettings(graph);
  let completed = 0;
  let handle: number | null = null;
  let cancelled = false;

  const tick = () => {
    handle = null;
    if (cancelled) return;
    const frameStart = scheduler.now();
    do {
      const step = Math.min(STEP_ITERATIONS, iterations - completed);
      forceAtlas2.assign(graph, { iterations: step, settings });
      completed += step;
    } while (completed < iterations && scheduler.now() - frameStart < FRAME_BUDGET_MS);
    if (options.animate) options.onFrame();
    if (completed < iterations) {
      handle = scheduler.requestFrame(tick);
    } else {
      options.onDone();
    }
  };

  handle = scheduler.requestFrame(tick);
  return {
    cancel: () => {
      cancelled = true;
      if (handle !== null) scheduler.cancelFrame(handle);
      handle = null;
    },
  };
}
