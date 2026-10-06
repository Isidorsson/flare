import { createStore } from "zustand";

import { agentActions, initialAgentData } from "./agent-slice";
import { bufferActions, initialBufferState } from "./buffers-slice";
import type { FilesState, StoreContext } from "./files-types";
import type { FsGateway } from "./fs-gateway";
import { initialTreeState, treeActions } from "./tree-slice";
import { initialWorkspaceData, workspaceActions } from "./workspace-slice";

export function createFilesStore(gateway: FsGateway, now: () => number = Date.now) {
  return createStore<FilesState>()((set, get) => {
    const ctx: StoreContext = { set, get, gateway, now };
    return {
      ...initialWorkspaceData(),
      ...initialTreeState(),
      ...initialBufferState(),
      ...initialAgentData(),
      ...workspaceActions(ctx),
      ...treeActions(ctx),
      ...bufferActions(ctx),
      ...agentActions(ctx),
    };
  });
}

export type FilesStore = ReturnType<typeof createFilesStore>;
