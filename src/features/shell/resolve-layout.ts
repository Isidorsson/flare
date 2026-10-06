import { clamp } from "@/shared/lib/clamp";
import type { SizeBounds } from "@/shared/lib/splitter-math";

import {
  CENTER_MIN_WIDTH,
  CHAT_MIN_HEIGHT,
  FILES_MIN_WIDTH,
  PANE_LIMITS,
  TERMINAL_HEADER_HEIGHT,
  type PaneLimits,
} from "./layout-constants";

export interface Viewport {
  width: number;
  height: number;
}

export interface StoredSizes {
  sidebarWidth: number;
  rightWidth: number;
  graphWidth: number;
  terminalHeight: number;
}

export interface ResolvedLayout {
  sidebar: number;
  right: number;
  graph: number;
  terminal: number;
  bounds: {
    sidebar: SizeBounds;
    right: SizeBounds;
    graph: SizeBounds;
    terminal: SizeBounds;
  };
}

function boundsWithin(limits: PaneLimits, available: number): SizeBounds {
  return { min: limits.min, max: Math.max(limits.min, Math.min(limits.max, available)) };
}

function fitSidePanes(stored: StoredSizes, budget: number) {
  const sidebar = clamp(stored.sidebarWidth, PANE_LIMITS.sidebar.min, PANE_LIMITS.sidebar.max);
  const right = clamp(stored.rightWidth, PANE_LIMITS.right.min, PANE_LIMITS.right.max);
  const overflow = sidebar + right - budget;
  if (overflow <= 0) return { sidebar, right };

  const rightCut = Math.min(overflow, right - PANE_LIMITS.right.min);
  const sidebarCut = Math.min(overflow - rightCut, sidebar - PANE_LIMITS.sidebar.min);
  return { sidebar: sidebar - sidebarCut, right: right - rightCut };
}

export function resolveLayout(stored: StoredSizes, viewport: Viewport): ResolvedLayout {
  const sideBudget = viewport.width - CENTER_MIN_WIDTH;
  const { sidebar, right } = fitSidePanes(stored, sideBudget);

  const terminalBounds = boundsWithin(
    PANE_LIMITS.terminal,
    viewport.height - CHAT_MIN_HEIGHT - TERMINAL_HEADER_HEIGHT,
  );

  const graphBounds = boundsWithin(PANE_LIMITS.graph, right - FILES_MIN_WIDTH);

  return {
    sidebar,
    right,
    graph: clamp(stored.graphWidth, graphBounds.min, graphBounds.max),
    terminal: clamp(stored.terminalHeight, terminalBounds.min, terminalBounds.max),
    bounds: {
      sidebar: boundsWithin(PANE_LIMITS.sidebar, sideBudget - right),
      right: boundsWithin(PANE_LIMITS.right, sideBudget - sidebar),
      graph: graphBounds,
      terminal: terminalBounds,
    },
  };
}
