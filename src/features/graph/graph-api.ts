import { invoke } from "@tauri-apps/api/core";

import { changeSchema, graphSnapshotSchema, type Change, type GraphSnapshot } from "./graph-types";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface GraphApi {
  build: (root: string) => Promise<GraphSnapshot>;
  snapshot: () => Promise<GraphSnapshot>;
  updateFile: (path: string) => Promise<Change>;
  removeFile: (path: string) => Promise<Change>;
}

export function createGraphApi(call: Invoke): GraphApi {
  return {
    build: async (root) => graphSnapshotSchema.parse(await call("graph_build", { root })),
    snapshot: async () => graphSnapshotSchema.parse(await call("graph_snapshot")),
    updateFile: async (path) => changeSchema.parse(await call("graph_update_file", { path })),
    removeFile: async (path) => changeSchema.parse(await call("graph_remove_file", { path })),
  };
}

export const tauriGraphApi: GraphApi = createGraphApi(invoke);
