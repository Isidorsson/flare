import { createStore } from "zustand";

import {
  CheckpointController,
  INITIAL_SNAPSHOT,
  type CheckpointDeps,
  type CheckpointSnapshot,
} from "./checkpoint-controller";
import type { RestoreTarget, TurnContext } from "./checkpoint-types";

export type { CheckpointDeps } from "./checkpoint-controller";

export interface CheckpointState extends CheckpointSnapshot {
  startTurn: (context: TurnContext) => void;
  endTurn: () => void;
  reportUnavailable: (reason: string) => void;
  pruneWorkspace: (root: string) => void;
  requestRestore: (target: RestoreTarget) => void;
  confirmRestore: () => void;
  cancelRestore: () => void;
  runNoticeAction: () => void;
  dismissNotice: () => void;
}

export function createCheckpointStore(deps: CheckpointDeps) {
  return createStore<CheckpointState>()((set, get) => {
    const controller = new CheckpointController(deps, {
      get,
      set: (update) => {
        set(update);
      },
    });
    return {
      ...INITIAL_SNAPSHOT,
      startTurn: (context) => {
        controller.startTurn(context);
      },
      endTurn: () => {
        controller.endTurn();
      },
      reportUnavailable: (reason) => {
        controller.reportUnavailable(reason);
      },
      pruneWorkspace: (root) => {
        controller.pruneWorkspace(root);
      },
      requestRestore: (target) => {
        controller.requestRestore(target);
      },
      confirmRestore: () => {
        controller.confirmRestore();
      },
      cancelRestore: () => {
        controller.cancelRestore();
      },
      runNoticeAction: () => {
        controller.runNoticeAction();
      },
      dismissNotice: () => {
        controller.dismissNotice();
      },
    };
  });
}

export type CheckpointStore = ReturnType<typeof createCheckpointStore>;
