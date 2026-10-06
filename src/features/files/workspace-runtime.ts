import type { FilesStore } from "./files-store";
import type { FsGateway } from "./fs-gateway";
import { errorMessage } from "./store-utils";

interface RootState {
  root: string | null;
}

export interface RootSource {
  getState: () => RootState;
  subscribe: (listener: (state: RootState, previous: RootState) => void) => () => void;
}

export interface WorkspaceRuntimeDeps {
  workspace: RootSource;
  files: FilesStore;
  gateway: FsGateway;
}

/**
 * Keeps the Rust side (sandbox root, watcher) and the files store in step
 * with the chosen workspace root, and pipes watcher batches into the store.
 * Lives outside React so file-change tracking keeps working while the Files
 * tab is not mounted.
 */
export function startWorkspaceRuntime({ workspace, files, gateway }: WorkspaceRuntimeDeps): () => Promise<void> {
  let latest = 0;

  async function sync(root: string | null) {
    latest += 1;
    const ticket = latest;
    files.getState().resetWorkspace(root);
    try {
      if (root === null) {
        await gateway.closeWorkspace();
        return;
      }
      const canonicalRoot = await gateway.openWorkspace(root);
      if (ticket !== latest) return;
      await files.getState().workspaceOpened(canonicalRoot);
    } catch (error) {
      if (ticket === latest) files.getState().workspaceFailed(errorMessage(error));
    }
  }

  const stopWatchingRoot = workspace.subscribe((state, previous) => {
    if (state.root !== previous.root) void sync(state.root);
  });
  void sync(workspace.getState().root);

  const subscription = gateway
    .subscribe((batch) => {
      void files.getState().applyWatchBatch(batch);
    })
    .catch((error: unknown) => {
      console.error("flare: could not subscribe to file changes", error);
      return null;
    });

  return async () => {
    stopWatchingRoot();
    latest += 1;
    const unsubscribe = await subscription;
    if (unsubscribe !== null) await unsubscribe();
  };
}
