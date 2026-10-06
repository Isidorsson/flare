import { initialBufferState } from "./buffers-slice";
import type { StoreContext, WorkspaceSlice } from "./files-types";
import type { WatchBatch } from "./fs-schemas";
import { normalizePath } from "./paths";
import { initialTreeState } from "./tree-slice";
import { planWatchBatch } from "./watch-plan";

type WorkspaceData = Pick<WorkspaceSlice, "phase" | "root" | "generation" | "workspaceError">;
type WorkspaceActions = Omit<WorkspaceSlice, keyof WorkspaceData>;

export function initialWorkspaceData(): WorkspaceData {
  return { phase: "idle", root: null, generation: 0, workspaceError: null };
}

export function workspaceActions(ctx: StoreContext): WorkspaceActions {
  const { set, get } = ctx;

  async function applyWatchBatch(batch: WatchBatch) {
    const state = get();
    const plan = planWatchBatch(state, batch);
    if (plan === null) return;
    for (const path of plan.deletedFiles) state.applyDiskContent(path, null);
    await Promise.all([
      ...plan.syncFiles.map((path) => state.syncFromDisk(path)),
      ...plan.reloadDirs.map((path) => state.loadDir(path)),
    ]);
  }

  return {
    resetWorkspace: (requestedRoot) => {
      set((state) => ({
        ...initialTreeState(),
        ...initialBufferState(),
        changes: [],
        generation: state.generation + 1,
        phase: requestedRoot === null ? "idle" : "opening",
        root: requestedRoot === null ? null : normalizePath(requestedRoot),
        workspaceError: null,
      }));
    },
    workspaceOpened: async (canonicalRoot) => {
      const root = normalizePath(canonicalRoot);
      set({ phase: "ready", root });
      await get().loadDir(root);
    },
    workspaceFailed: (message) => {
      set({ phase: "error", workspaceError: message });
    },
    applyWatchBatch,
  };
}
