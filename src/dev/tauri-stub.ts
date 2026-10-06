import { graphSnapshotSchema, type GraphSnapshot } from "@/features/graph/graph-types";

interface StubState {
  snapshot: GraphSnapshot | null;
}

const state: StubState = { snapshot: null };

export function setStubSnapshot(snapshot: GraphSnapshot): void {
  state.snapshot = graphSnapshotSchema.parse(snapshot);
}

function currentSnapshot(): GraphSnapshot {
  if (state.snapshot === null) throw new Error("graph lab has no fixture loaded");
  return state.snapshot;
}

function invoke(command: string): Promise<unknown> {
  switch (command) {
    case "graph_build":
    case "graph_snapshot":
      return Promise.resolve(currentSnapshot());
    default:
      return Promise.reject(new Error(`graph lab does not stub "${command}"`));
  }
}

export function installTauriStub(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
}
