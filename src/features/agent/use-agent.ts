import { useStore } from "zustand";

import { workspaceStore } from "@/features/workspace/use-workspace";
import { createSafeStorage } from "@/shared/lib/safe-storage";

import { agentEvents } from "./agent-events";
import { createAgentStore, type AgentState } from "./agent-store";
import { createTauriTransport } from "./bridge-transport";

export const agentStore = createAgentStore({
  transport: createTauriTransport(),
  getWorkspaceRoot: () => workspaceStore.getState().root,
  publish: (event) => {
    agentEvents.publish(event);
  },
  now: () => Date.now(),
  createId: () => crypto.randomUUID(),
  storage: createSafeStorage(() => window.localStorage),
});

export function useAgent<T>(selector: (state: AgentState) => T): T {
  return useStore(agentStore, selector);
}
