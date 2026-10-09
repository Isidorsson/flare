import { useStore } from "zustand";

import { tauriFsGateway } from "@/features/files/fs-gateway";
import { workspaceStore } from "@/features/workspace/use-workspace";

import type { Timers } from "./refresh-scheduler";
import { tauriVcsGateway } from "./vcs-gateway";
import { startVcsRuntime } from "./vcs-runtime";
import { changedFileCount } from "./vcs-selectors";
import { createVcsStore, type VcsState } from "./vcs-store";
import type { CommitMessageGenerator, PullRequestGenerator } from "./vcs-types";

export const vcsStore = createVcsStore({ gateway: tauriVcsGateway });

const browserTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => {
    window.clearTimeout(id);
  },
};

function onWindowFocus(listener: () => void): () => void {
  window.addEventListener("focus", listener);
  return () => {
    window.removeEventListener("focus", listener);
  };
}

const stopRuntime = startVcsRuntime({
  workspace: workspaceStore,
  store: vcsStore,
  subscribeChanges: (onChange) => tauriFsGateway.subscribe(onChange),
  onFocus: onWindowFocus,
  timers: browserTimers,
});

import.meta.hot?.dispose(() => {
  void stopRuntime();
});

export function useVcs<T>(selector: (state: VcsState) => T): T {
  return useStore(vcsStore, selector);
}

/** How many files are changed, staged or not: the badge on the Changes tab. */
export function useChangedFileCount(): number {
  return useVcs(changedFileCount);
}

/**
 * Reads the git status and the pull request state again, e.g. when the Changes tab opens: the file
 * watcher never sees `.git`, and the pull request state lives on GitHub.
 */
export function refreshVcs(): Promise<void> {
  return vcsStore.getState().reload();
}

export interface VcsConfig {
  /** Writes a commit message for a diff; until it is given, the Generate button explains it is unavailable. */
  generateMessage: CommitMessageGenerator;
  /** Writes a pull request title and description from a branch's commits; until it is given, that Generate button explains it is unavailable. */
  generatePullRequest?: PullRequestGenerator;
}

/** The one place the Changes tab is wired to the rest of the app. Call it once at startup. */
export function configureVcs(config: VcsConfig): void {
  vcsStore.getState().configure(config.generateMessage);
  if (config.generatePullRequest !== undefined) vcsStore.getState().configurePullRequest(config.generatePullRequest);
}
