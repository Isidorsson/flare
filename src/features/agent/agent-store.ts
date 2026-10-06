import type { PermissionDecision } from "@flare/protocol";
import { createStore } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";

import { AgentController, type AgentDeps, type AgentSnapshot } from "./agent-controller";
import { DEFAULT_SESSION_SETTINGS, sessionSettingsSchema, type SessionSettings } from "./session-settings";

export const AGENT_SETTINGS_STORAGE_KEY = "flare.session-settings";

const persistedAgentSchema = z.object({ settings: sessionSettingsSchema });

export interface AgentState extends AgentSnapshot {
  sendMessage: (text: string) => void;
  respondToPermission: (requestId: string, decision: PermissionDecision) => void;
  interrupt: () => void;
  newThread: () => void;
  selectThread: (id: string) => void;
  changeSettings: (patch: Partial<SessionSettings>) => void;
}

export interface AgentStoreDeps extends AgentDeps {
  storage: StateStorage;
}

function mergePersistedAgent(persisted: unknown, current: AgentState): AgentState {
  if (persisted === undefined) return current;
  const parsed = persistedAgentSchema.safeParse(persisted);
  if (!parsed.success) {
    console.warn("flare: discarding invalid persisted session settings", parsed.error.message);
    return current;
  }
  return { ...current, ...parsed.data };
}

export function createAgentStore({ storage, ...deps }: AgentStoreDeps) {
  return createStore<AgentState>()(
    persist(
      (set, get) => {
        const controller = new AgentController(deps, {
          get,
          set: (update) => {
            set(update);
          },
        });
        return {
          settings: DEFAULT_SESSION_SETTINGS,
          threads: [],
          activeThreadId: null,
          liveThreadId: null,
          sendMessage: (text) => {
            controller.sendMessage(text);
          },
          respondToPermission: (requestId, decision) => {
            controller.respondToPermission(requestId, decision);
          },
          interrupt: () => {
            controller.interrupt();
          },
          newThread: () => {
            controller.newThread();
          },
          selectThread: (id) => {
            controller.selectThread(id);
          },
          changeSettings: (patch) => {
            controller.changeSettings(patch);
          },
        };
      },
      {
        name: AGENT_SETTINGS_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({ settings: state.settings }),
        merge: mergePersistedAgent,
      },
    ),
  );
}

export type AgentStore = ReturnType<typeof createAgentStore>;
