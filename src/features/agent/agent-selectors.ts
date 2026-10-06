import type { AgentSnapshot } from "./agent-controller";
import type { Thread } from "./thread-types";

export type ComposerMode = "no-folder" | "blocked" | "running" | "ready";

export function selectActiveThread(state: AgentSnapshot): Thread | null {
  return state.threads.find((thread) => thread.id === state.activeThreadId) ?? null;
}

export function selectLiveThread(state: AgentSnapshot): Thread | null {
  return state.threads.find((thread) => thread.id === state.liveThreadId) ?? null;
}

export function selectIsBusy(state: AgentSnapshot): boolean {
  return selectLiveThread(state)?.status === "running";
}

export function selectComposerMode(state: AgentSnapshot, workspaceRoot: string | null): ComposerMode {
  if (workspaceRoot === null && selectActiveThread(state) === null) return "no-folder";
  if (!selectIsBusy(state)) return "ready";
  return state.liveThreadId === state.activeThreadId ? "running" : "blocked";
}
