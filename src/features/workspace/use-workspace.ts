import { useStore } from "zustand";

import { createSafeStorage } from "@/shared/lib/safe-storage";

import { createWorkspaceStore, type WorkspaceState } from "./workspace-store";

export const workspaceStore = createWorkspaceStore(createSafeStorage(() => window.localStorage));

export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(workspaceStore, selector);
}
