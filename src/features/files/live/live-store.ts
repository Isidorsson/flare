import { createStore } from "zustand";

import { pruneTouches, recordTouch, type TouchEvent, type Touches } from "./heat";
import type { Play } from "./live-types";

export interface LiveState {
  // What the editor shows over the file right now.
  play: Play | null;
  touches: Touches;
  setPlay: (play: Play | null) => void;
  // Clears the play only if it is still the one with this id.
  clearPlay: (id: number) => void;
  touch: (path: string, event: TouchEvent) => void;
  reset: () => void;
}

export function createLiveStore() {
  return createStore<LiveState>()((set) => ({
    play: null,
    touches: {},
    setPlay: (play) => {
      set({ play });
    },
    clearPlay: (id) => {
      set((state) => (state.play?.id === id ? { play: null } : {}));
    },
    touch: (path, event) => {
      set((state) => ({ touches: pruneTouches(recordTouch(state.touches, path, event), event.at) }));
    },
    reset: () => {
      set({ play: null, touches: {} });
    },
  }));
}

export type LiveStore = ReturnType<typeof createLiveStore>;
