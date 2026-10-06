import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";

import {
  checkpointListSchema,
  pruneReportSchema,
  restorePlanSchema,
  restoreResultSchema,
  snapshotSchema,
  toCheckpointError,
  turnDiffSchema,
  type CheckpointList,
  type PruneReport,
  type RestorePlan,
  type RestoreRequest,
  type RestoreResult,
  type Snapshot,
  type TurnDiff,
} from "./checkpoint-schemas";

export interface WorkspaceSession {
  root: string;
  sessionId: string;
}

export type CreateInput = WorkspaceSession & ({ phase: "start" } | { phase: "end"; turn: number });

export interface RestoreInput extends WorkspaceSession {
  request: RestoreRequest;
}

export interface CheckpointGateway {
  create: (input: CreateInput) => Promise<Snapshot>;
  list: (input: WorkspaceSession) => Promise<CheckpointList>;
  diff: (input: WorkspaceSession & { turn: number }) => Promise<TurnDiff>;
  plan: (input: RestoreInput) => Promise<RestorePlan>;
  restore: (input: RestoreInput & { force: boolean }) => Promise<RestoreResult>;
  prune: (root: string) => Promise<PruneReport>;
}

async function call<T>(command: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke(command, args);
  } catch (error) {
    throw toCheckpointError(error);
  }
  return schema.parse(raw);
}

export const tauriCheckpointGateway: CheckpointGateway = {
  create: (input) => call("checkpoint_create", { request: input }, snapshotSchema),
  list: (input) => call("checkpoint_list", { query: input }, checkpointListSchema),
  diff: (input) => call("checkpoint_diff", { query: input }, turnDiffSchema),
  plan: (input) => call("checkpoint_plan", { query: input }, restorePlanSchema),
  restore: (input) => call("checkpoint_restore", { command: input }, restoreResultSchema),
  prune: (root) => call("checkpoint_prune", { query: { root } }, pruneReportSchema),
};
