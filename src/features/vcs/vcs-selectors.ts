import { EMPTY_DRAFT } from "./commit-draft";
import type { CommitDraft, VcsSnapshot } from "./vcs-types";

export const BUSY_REASON = "Another git action is still running";
const NOT_A_REPO_REASON = "This folder is not a git repository";
const DETACHED_REASON = "HEAD is detached: switch to a branch first";

export function draftOf(snapshot: Pick<VcsSnapshot, "root" | "drafts">): CommitDraft {
  return (snapshot.root === null ? undefined : snapshot.drafts[snapshot.root]) ?? EMPTY_DRAFT;
}

export function changedFileCount(snapshot: Pick<VcsSnapshot, "status">): number {
  return snapshot.status?.isRepo === true ? snapshot.status.files.length : 0;
}

function repoReason(snapshot: Pick<VcsSnapshot, "status">): string | null {
  return snapshot.status?.isRepo === true ? null : NOT_A_REPO_REASON;
}

function busyReason(snapshot: Pick<VcsSnapshot, "busy">): string | null {
  return snapshot.busy === null ? null : BUSY_REASON;
}

/** The reason a git action cannot start now, or null: not a repository, or another action is running. */
export function actionBlockedReason(snapshot: Pick<VcsSnapshot, "status" | "busy">): string | null {
  return repoReason(snapshot) ?? busyReason(snapshot);
}

export function pullBlockedReason(snapshot: Pick<VcsSnapshot, "status" | "busy">): string | null {
  const base = actionBlockedReason(snapshot);
  if (base !== null || snapshot.status === null) return base;
  if (snapshot.status.branch === null) return DETACHED_REASON;
  return snapshot.status.upstream === null ? "This branch has no upstream to pull from yet" : null;
}

export function pushBlockedReason(snapshot: Pick<VcsSnapshot, "status" | "busy">): string | null {
  const base = actionBlockedReason(snapshot);
  if (base !== null || snapshot.status === null) return base;
  if (snapshot.status.branch === null) return DETACHED_REASON;
  const inStep = snapshot.status.upstream !== null && snapshot.status.ahead === 0;
  return inStep ? "No commits to push" : null;
}

function stagedCount(snapshot: Pick<VcsSnapshot, "status">): number {
  return snapshot.status?.files.filter((file) => file.staged !== null && file.staged !== "conflicted").length ?? 0;
}

function hasConflicts(snapshot: Pick<VcsSnapshot, "status">): boolean {
  return snapshot.status?.files.some((file) => file.staged === "conflicted" || file.unstaged === "conflicted") ?? false;
}

export function commitBlockedReason(snapshot: VcsSnapshot): string | null {
  const base = actionBlockedReason(snapshot);
  if (base !== null) return base;
  if (snapshot.generating) return "A commit message is being generated";
  if (hasConflicts(snapshot)) return "Resolve the merge conflicts and stage those files first";
  if (stagedCount(snapshot) === 0) return "Stage at least one file to commit";
  return draftOf(snapshot).subject.trim() === "" ? "Write a commit subject first" : null;
}

export function commitAndPushBlockedReason(snapshot: VcsSnapshot): string | null {
  const base = commitBlockedReason(snapshot);
  if (base !== null) return base;
  return snapshot.status?.branch === null ? DETACHED_REASON : null;
}

export const NO_GENERATOR_REASON = "Commit message generation is not connected yet";

export function generateBlockedReason(snapshot: VcsSnapshot): string | null {
  if (!snapshot.canGenerate) return NO_GENERATOR_REASON;
  const base = repoReason(snapshot);
  if (base !== null) return base;
  if (snapshot.generating) return "A message is already being generated";
  if (snapshot.busy === "commit" || snapshot.busy === "commitAndPush") return "A commit is in progress";
  return snapshot.status?.files.length === 0 ? "There are no changes to describe" : null;
}
