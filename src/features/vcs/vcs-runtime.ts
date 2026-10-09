import { createRefreshScheduler, type Timers } from "./refresh-scheduler";
import type { VcsStore } from "./vcs-store";

interface RootState {
  root: string | null;
}

export interface RootSource {
  getState: () => RootState;
  subscribe: (listener: (state: RootState, previous: RootState) => void) => () => void;
}

export interface VcsRuntimeDeps {
  workspace: RootSource;
  store: Pick<VcsStore, "getState">;
  /** Calls `onChange` whenever files in the workspace change on disk; resolves to the way to stop. */
  subscribeChanges: (onChange: () => void) => Promise<() => Promise<void>>;
  /** Calls `listener` whenever the window regains focus; returns the way to stop. */
  onFocus: (listener: () => void) => () => void;
  timers: Timers;
}

/**
 * Keeps the git status in step with the workspace: it follows the chosen root and re-reads the status
 * when files change on disk or the window regains focus. The file watcher never reports `.git` itself, so
 * git commands run in a terminal are picked up on focus, when the Changes tab opens or by Refresh.
 * Lives outside React so the change count stays right while the Changes tab is not mounted.
 */
export function startVcsRuntime({ workspace, store, subscribeChanges, onFocus, timers }: VcsRuntimeDeps): () => Promise<void> {
  const refresher = createRefreshScheduler(() => {
    void store.getState().refresh();
  }, timers);

  const stopWatchingRoot = workspace.subscribe((state, previous) => {
    if (state.root === previous.root) return;
    refresher.cancel();
    void store.getState().setRoot(state.root);
  });
  void store.getState().setRoot(workspace.getState().root);

  const stopFocus = onFocus(refresher.request);
  const subscription = subscribeChanges(refresher.request).catch((error: unknown) => {
    console.error("flare: could not subscribe to file changes for git status", error);
    return null;
  });

  return async () => {
    stopWatchingRoot();
    stopFocus();
    refresher.cancel();
    const unsubscribe = await subscription;
    if (unsubscribe !== null) await unsubscribe();
  };
}
