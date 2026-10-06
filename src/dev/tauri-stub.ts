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

function reverseAdjacency(snapshot: GraphSnapshot): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const { source, target } of snapshot.edges) {
    dependents.set(target, [...(dependents.get(target) ?? []), source]);
  }
  return dependents;
}

function dependentDepths(snapshot: GraphSnapshot, origin: string): { id: string; depth: number }[] {
  const dependents = reverseAdjacency(snapshot);
  const depths = new Map<string, number>([[origin, 0]]);
  let frontier = [origin];
  for (let depth = 1; frontier.length > 0; depth += 1) {
    const reached = [...new Set(frontier.flatMap((id) => dependents.get(id) ?? []))].filter((id) => !depths.has(id));
    for (const id of reached) depths.set(id, depth);
    frontier = reached;
  }
  return [...depths.entries()].filter(([, depth]) => depth > 0).map(([id, depth]) => ({ id, depth }));
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string") throw new Error(`stubbed command expected a string "${key}"`);
  return value;
}

function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case "graph_build":
    case "graph_snapshot":
      return Promise.resolve(currentSnapshot());
    case "graph_blast_radius": {
      const origin = stringArg(args, "path");
      return Promise.resolve({ origin, nodes: dependentDepths(currentSnapshot(), origin) });
    }
    default:
      return Promise.reject(new Error(`graph lab does not stub "${command}"`));
  }
}

export function installTauriStub(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: { invoke }, configurable: true });
}
