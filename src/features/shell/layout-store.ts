import { createStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";

import { clamp } from "@/shared/lib/clamp";

import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_STORAGE_VERSION,
  PANE_LIMITS,
  type PaneLimits,
} from "./layout-constants";

const clampToLimits = (value: number, limits: PaneLimits): number =>
  clamp(value, limits.min, limits.max);

const paneSize = (limits: PaneLimits) => z.number().transform((value) => clampToLimits(value, limits));

const persistedLayoutSchema = z.object({
  sidebarWidth: paneSize(PANE_LIMITS.sidebar),
  rightWidth: paneSize(PANE_LIMITS.right),
  terminalHeight: paneSize(PANE_LIMITS.terminal),
  terminalOpen: z.boolean(),
  graphWidth: paneSize(PANE_LIMITS.graph),
});

type PersistedLayout = z.infer<typeof persistedLayoutSchema>;

export interface LayoutState extends PersistedLayout {
  setSidebarWidth: (px: number) => void;
  setRightWidth: (px: number) => void;
  setTerminalHeight: (px: number) => void;
  toggleTerminal: () => void;
  setGraphWidth: (px: number) => void;
}

export const DEFAULT_LAYOUT: PersistedLayout = {
  sidebarWidth: PANE_LIMITS.sidebar.initial,
  rightWidth: PANE_LIMITS.right.initial,
  terminalHeight: PANE_LIMITS.terminal.initial,
  terminalOpen: true,
  graphWidth: PANE_LIMITS.graph.initial,
};

function mergePersistedLayout(persisted: unknown, current: LayoutState): LayoutState {
  if (persisted === undefined) return current;
  const parsed = persistedLayoutSchema.safeParse(persisted);
  if (!parsed.success) {
    console.warn("flare: discarding invalid persisted layout", parsed.error.message);
    return current;
  }
  return { ...current, ...parsed.data };
}

function pickPersisted(state: LayoutState): PersistedLayout {
  return {
    sidebarWidth: state.sidebarWidth,
    rightWidth: state.rightWidth,
    terminalHeight: state.terminalHeight,
    terminalOpen: state.terminalOpen,
    graphWidth: state.graphWidth,
  };
}

export function createLayoutStore(storage: StateStorage) {
  return createStore<LayoutState>()(
    persist(
      (set) => ({
        ...DEFAULT_LAYOUT,
        setSidebarWidth: (px) => {
          set({ sidebarWidth: clampToLimits(px, PANE_LIMITS.sidebar) });
        },
        setRightWidth: (px) => {
          set({ rightWidth: clampToLimits(px, PANE_LIMITS.right) });
        },
        setTerminalHeight: (px) => {
          set({ terminalHeight: clampToLimits(px, PANE_LIMITS.terminal) });
        },
        toggleTerminal: () => {
          set((state) => ({ terminalOpen: !state.terminalOpen }));
        },
        setGraphWidth: (px) => {
          set({ graphWidth: clampToLimits(px, PANE_LIMITS.graph) });
        },
      }),
      {
        name: LAYOUT_STORAGE_KEY,
        version: LAYOUT_STORAGE_VERSION,
        storage: createJSONStorage(() => storage),
        partialize: pickPersisted,
        merge: mergePersistedLayout,
      },
    ),
  );
}
