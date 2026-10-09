import { createStore } from "zustand";

import { bindPrActions, type PrActions } from "./pr-actions";
import { INITIAL_SNAPSHOT, VcsController, type VcsDeps } from "./vcs-controller";
import type { CommitMessageGenerator, FileSelection, VcsAction, VcsSnapshot } from "./vcs-types";

export type { VcsDeps } from "./vcs-controller";

/** Every action answers once it has finished and never rejects: a failure is recorded under `errors`. */
export interface VcsActions extends PrActions {
  configure: (generate: CommitMessageGenerator) => void;
  setRoot: (root: string | null) => Promise<void>;
  /** Reads the git status again; what GitHub says about the branch is left alone, see `reload`. */
  refresh: () => Promise<void>;
  /** Reads the git status and what GitHub says about the branch again. */
  reload: () => Promise<void>;
  selectFile: (selection: FileSelection | null) => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  unstageAll: () => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: () => Promise<void>;
  commitAndPush: () => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  loadBranches: () => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  deleteBranch: (name: string, force: boolean) => Promise<void>;
  generateMessage: () => Promise<void>;
  setSubject: (subject: string) => void;
  setDescription: (description: string) => void;
  setIncludeBody: (includeBody: boolean) => void;
  dismissError: (action: VcsAction) => void;
}

export type VcsState = VcsSnapshot & VcsActions;

export function createVcsStore(deps: VcsDeps) {
  return createStore<VcsState>()((set, get) => {
    const controller = new VcsController(deps, {
      get,
      set: (update) => {
        set(update);
      },
    });
    return {
      ...INITIAL_SNAPSHOT,
      configure: (generate) => {
        controller.configure(generate);
      },
      setRoot: (root) => controller.setRoot(root),
      refresh: () => controller.refresh(),
      reload: () => controller.reload(),
      selectFile: (selection) => controller.selectFile(selection),
      stage: (paths) => controller.stage(paths),
      stageAll: () => controller.stageAll(),
      unstage: (paths) => controller.unstage(paths),
      unstageAll: () => controller.unstageAll(),
      discard: (paths) => controller.discard(paths),
      commit: () => controller.commit(),
      commitAndPush: () => controller.commitAndPush(),
      fetch: () => controller.fetch(),
      pull: () => controller.pull(),
      push: () => controller.push(),
      loadBranches: () => controller.loadBranches(),
      switchBranch: (name) => controller.switchBranch(name),
      createBranch: (name) => controller.createBranch(name),
      deleteBranch: (name, force) => controller.deleteBranch(name, force),
      generateMessage: () => controller.generateMessage(),
      setSubject: (subject) => {
        controller.setSubject(subject);
      },
      setDescription: (description) => {
        controller.setDescription(description);
      },
      setIncludeBody: (includeBody) => {
        controller.setIncludeBody(includeBody);
      },
      ...bindPrActions(controller),
      dismissError: (action) => {
        controller.dismissError(action);
      },
    };
  });
}

export type VcsStore = ReturnType<typeof createVcsStore>;
