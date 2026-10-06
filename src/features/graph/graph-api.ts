import { invoke } from "@tauri-apps/api/core";

import {
  blastRadiusSchema,
  changeSchema,
  graphSnapshotSchema,
  type BlastRadius,
  type Change,
  type GraphSnapshot,
} from "./graph-types";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface GraphApi {
  build: (root: string) => Promise<GraphSnapshot>;
  snapshot: () => Promise<GraphSnapshot>;
  blastRadius: (path: string) => Promise<BlastRadius>;
  updateFile: (path: string) => Promise<Change>;
  removeFile: (path: string) => Promise<Change>;
}

export function createGraphApi(call: Invoke): GraphApi {
  return {
    build: async (root) => graphSnapshotSchema.parse(await call("graph_build", { root })),
    snapshot: async () => graphSnapshotSchema.parse(await call("graph_snapshot")),
    blastRadius: async (path) => blastRadiusSchema.parse(await call("graph_blast_radius", { path })),
    updateFile: async (path) => changeSchema.parse(await call("graph_update_file", { path })),
    removeFile: async (path) => changeSchema.parse(await call("graph_remove_file", { path })),
  };
}

export const tauriGraphApi: GraphApi = createGraphApi(invoke);
