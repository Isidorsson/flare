import { useStore } from "zustand";

import { workspaceStore } from "@/features/workspace/use-workspace";

import { createFilesStore } from "./files-store";
import type { FilesState } from "./files-types";
import { tauriFsGateway } from "./fs-gateway";
import { startWorkspaceRuntime } from "./workspace-runtime";

export const filesStore = createFilesStore(tauriFsGateway);

const stopRuntime = startWorkspaceRuntime({
  workspace: workspaceStore,
  files: filesStore,
  gateway: tauriFsGateway,
});

import.meta.hot?.dispose(() => {
  void stopRuntime();
});

export function useFiles<T>(selector: (state: FilesState) => T): T {
  return useStore(filesStore, selector);
}
