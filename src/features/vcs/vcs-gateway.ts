import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";

import {
  branchListSchema,
  commitResultSchema,
  fileDiffSchema,
  messageContextSchema,
  prContextSchema,
  prCreateResultSchema,
  prInfoSchema,
  toVcsError,
  vcsStatusSchema,
  type CommitResult,
  type FileDiff,
  type MessageContext,
  type PrContext,
  type PrCreateResult,
  type PrInfo,
  type VcsBranch,
  type VcsStatus,
} from "./vcs-schemas";

export interface RootRequest {
  root: string;
}

/** Paths are relative to the repository top, which may be above `root`. */
export interface PathsRequest extends RootRequest {
  /** Empty means every file for stage and unstage; discard refuses an empty list. */
  paths: string[];
}

export interface FileDiffRequest extends RootRequest {
  path: string;
  staged: boolean;
}

export interface CommitRequest extends RootRequest {
  message: string;
}

export interface BranchRequest extends RootRequest {
  name: string;
}

export interface DeleteBranchRequest extends BranchRequest {
  force: boolean;
}

export interface PrContextRequest extends RootRequest {
  base: string;
}

export interface PrCreateRequest extends RootRequest {
  title: string;
  body: string;
  base: string;
  draft: boolean;
}

/** Every command takes the workspace root plus its own fields; the ones that change the repository answer with the fresh status. */
export interface VcsGateway {
  status: (request: RootRequest) => Promise<VcsStatus>;
  fileDiff: (request: FileDiffRequest) => Promise<FileDiff>;
  stage: (request: PathsRequest) => Promise<VcsStatus>;
  unstage: (request: PathsRequest) => Promise<VcsStatus>;
  discard: (request: PathsRequest) => Promise<VcsStatus>;
  commit: (request: CommitRequest) => Promise<CommitResult>;
  branches: (request: RootRequest) => Promise<VcsBranch[]>;
  createBranch: (request: BranchRequest) => Promise<VcsStatus>;
  switchBranch: (request: BranchRequest) => Promise<VcsStatus>;
  deleteBranch: (request: DeleteBranchRequest) => Promise<VcsStatus>;
  fetch: (request: RootRequest) => Promise<VcsStatus>;
  pull: (request: RootRequest) => Promise<VcsStatus>;
  push: (request: RootRequest) => Promise<VcsStatus>;
  messageContext: (request: RootRequest) => Promise<MessageContext>;
  prInfo: (request: RootRequest) => Promise<PrInfo>;
  prContext: (request: PrContextRequest) => Promise<PrContext>;
  /** Pushes the branch first when needed, so the answer carries the fresh status. */
  prCreate: (request: PrCreateRequest) => Promise<PrCreateResult>;
}

async function call<T>(command: string, request: RootRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await invoke(command, { request });
  } catch (error) {
    throw toVcsError(error);
  }
  return schema.parse(raw);
}

export const tauriVcsGateway: VcsGateway = {
  status: (request) => call("vcs_status", request, vcsStatusSchema),
  fileDiff: (request) => call("vcs_file_diff", request, fileDiffSchema),
  stage: (request) => call("vcs_stage", request, vcsStatusSchema),
  unstage: (request) => call("vcs_unstage", request, vcsStatusSchema),
  discard: (request) => call("vcs_discard", request, vcsStatusSchema),
  commit: (request) => call("vcs_commit", request, commitResultSchema),
  branches: (request) => call("vcs_branches", request, branchListSchema),
  createBranch: (request) => call("vcs_branch_create", request, vcsStatusSchema),
  switchBranch: (request) => call("vcs_switch", request, vcsStatusSchema),
  deleteBranch: (request) => call("vcs_branch_delete", request, vcsStatusSchema),
  fetch: (request) => call("vcs_fetch", request, vcsStatusSchema),
  pull: (request) => call("vcs_pull", request, vcsStatusSchema),
  push: (request) => call("vcs_push", request, vcsStatusSchema),
  messageContext: (request) => call("vcs_message_context", request, messageContextSchema),
  prInfo: (request) => call("vcs_pr_info", request, prInfoSchema),
  prContext: (request) => call("vcs_pr_context", request, prContextSchema),
  prCreate: (request) => call("vcs_pr_create", request, prCreateResultSchema),
};
