import { useStore } from "zustand";

import { tauriGraphApi } from "./graph-api";
import { createGraphStore, type GraphState } from "./graph-store";
import { pulseClock, type PulseKind } from "./pulse";

export const graphStore = createGraphStore({ api: tauriGraphApi, now: pulseClock });

export function useGraph<T>(selector: (state: GraphState) => T): T {
  return useStore(graphStore, selector);
}

export function pulse(path: string, kind: PulseKind): void {
  graphStore.getState().pulse(path, kind);
}

export function loadGraph(root: string): Promise<void> {
  return graphStore.getState().load(root);
}

export function refreshGraph(): Promise<void> {
  return graphStore.getState().refresh();
}
