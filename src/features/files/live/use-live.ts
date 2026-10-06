import { useStore } from "zustand";

import { filesStore } from "../use-files";
import { AgentActivity } from "./agent-activity";
import { createLiveStore, type LiveState } from "./live-store";
import type { Scheduler } from "./player";

export const liveStore = createLiveStore();

const browserScheduler: Scheduler = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id);
  },
};

/** The one place the agent's activity is turned into what the editor, tabs and tree show. */
export const agentActivity = new AgentActivity({
  files: filesStore,
  live: liveStore,
  scheduler: browserScheduler,
  now: Date.now,
});

import.meta.hot?.dispose(() => {
  agentActivity.dispose();
});

export function useLive<T>(selector: (state: LiveState) => T): T {
  return useStore(liveStore, selector);
}
