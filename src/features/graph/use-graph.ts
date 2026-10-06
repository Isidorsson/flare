import { useStore } from "zustand";

import { activityKindOf, type ActivityInput, type AgentStatus, type PulseKind } from "./activity-types";
import { tauriGraphApi } from "./graph-api";
import { createGraphStore, type GraphState } from "./graph-store";
import { clock } from "./motion";

export const graphStore = createGraphStore({ api: tauriGraphApi, now: clock });

export function useGraph<T>(selector: (state: GraphState) => T): T {
  return useStore(graphStore, selector);
}

export function recordAgentActivity(input: ActivityInput): void {
  graphStore.getState().recordActivity(input);
}

export function setAgentStatus(status: AgentStatus): void {
  graphStore.getState().setAgentStatus(status);
}

export function startTurn(): void {
  graphStore.getState().startTurn();
}

export function pulse(path: string, kind: PulseKind): void {
  recordAgentActivity({ path, kind: activityKindOf(kind) });
}

export function loadGraph(root: string): Promise<void> {
  return graphStore.getState().load(root);
}

export function refreshGraph(): Promise<void> {
  return graphStore.getState().refresh();
}
