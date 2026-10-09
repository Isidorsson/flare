import { EMPTY_PR_DRAFT, FALLBACK_BASES, prDraftKey } from "./pr-model";
import type { PrDraft, PrViewKind } from "./pr-types";
import type { PullRequest } from "./vcs-schemas";
import { actionBlockedReason } from "./vcs-selectors";
import type { VcsSnapshot } from "./vcs-types";

export const NO_PR_GENERATOR_REASON = "Pull request generation is not connected yet";
const NO_BASE_REASON = "Pick the branch the pull request merges into";

type Branching = Pick<VcsSnapshot, "status">;
type Drafting = Branching & Pick<VcsSnapshot, "root" | "prDrafts">;
type Viewing = Drafting & Pick<VcsSnapshot, "pr" | "errors">;

/** The checked-out branch of the open repository; null while HEAD is detached or outside a repository. */
export function currentBranchOf(snapshot: Branching): string | null {
  return snapshot.status?.isRepo === true ? snapshot.status.branch : null;
}

export function prDraftOf(snapshot: Drafting): PrDraft {
  const branch = currentBranchOf(snapshot);
  if (snapshot.root === null || branch === null) return EMPTY_PR_DRAFT;
  return snapshot.prDrafts[prDraftKey(snapshot.root, branch)] ?? EMPTY_PR_DRAFT;
}

/** The branch the pull request merges into: the one picked, else the repository's default. */
export function selectedBase(snapshot: Drafting & Pick<VcsSnapshot, "pr">): string | null {
  return prDraftOf(snapshot).base ?? snapshot.pr.info?.defaultBase ?? null;
}

function onBaseBranch(branch: string, snapshot: Drafting & Pick<VcsSnapshot, "pr">): boolean {
  const base = selectedBase(snapshot);
  return base === null ? FALLBACK_BASES.includes(branch) : branch === base;
}

/**
 * What the Pull request section shows. It stays hidden where a pull request makes no sense (detached HEAD,
 * the base branch itself) and until `gh` has answered once, so it never flashes on the default branch.
 */
export function prViewKind(snapshot: Viewing): PrViewKind {
  const branch = currentBranchOf(snapshot);
  if (branch === null) return "hidden";
  const { info } = snapshot.pr;
  const failed = snapshot.errors.loadPr !== undefined;
  if (info === null) return failed ? "failed" : "hidden";
  if (onBaseBranch(branch, snapshot)) return "hidden";
  if (!info.ghAvailable) return "ghMissing";
  if (!info.authenticated) return "signedOut";
  if (snapshot.pr.branch !== branch) return failed ? "failed" : "checking";
  return info.current === null ? "form" : "existing";
}

export function currentPrOf(snapshot: Viewing): PullRequest | null {
  return prViewKind(snapshot) === "existing" ? (snapshot.pr.info?.current ?? null) : null;
}

export interface PrTarget {
  root: string;
  branch: string;
  base: string;
  head: string | null;
}

/** Where a pull request would go from and to; null until the root, the branch and a base are all known. */
export function prTarget(snapshot: Drafting & Pick<VcsSnapshot, "pr">): PrTarget | null {
  const branch = currentBranchOf(snapshot);
  const base = selectedBase(snapshot);
  if (snapshot.root === null || snapshot.status === null || branch === null || base === null) return null;
  return { root: snapshot.root, branch, base, head: snapshot.status.head };
}

/** How many commits the branch has over the base, when the last look still applies; otherwise null. */
export function commitsAhead(snapshot: Drafting & Pick<VcsSnapshot, "pr">): number | null {
  const target = prTarget(snapshot);
  const { ahead } = snapshot.pr;
  if (target === null || ahead === null) return null;
  const same = ahead.branch === target.branch && ahead.base === target.base && ahead.head === target.head;
  return same ? ahead.commits : null;
}

const NOT_A_FORM: Record<Exclude<PrViewKind, "form">, string> = {
  hidden: "A pull request cannot be opened from here",
  checking: "Still checking GitHub for this branch",
  failed: "Could not read the pull request state from GitHub",
  ghMissing: "The GitHub CLI is not installed",
  signedOut: "The GitHub CLI is not signed in",
  existing: "This branch already has a pull request",
};

function formReason(snapshot: Viewing): string | null {
  const kind = prViewKind(snapshot);
  return kind === "form" ? null : NOT_A_FORM[kind];
}

export function generatePrBlockedReason(snapshot: VcsSnapshot): string | null {
  if (!snapshot.canGeneratePr) return NO_PR_GENERATOR_REASON;
  const reason = formReason(snapshot);
  if (reason !== null) return reason;
  if (snapshot.generatingPr) return "A pull request is already being written";
  if (snapshot.busy === "createPr") return "The pull request is being created";
  return prTarget(snapshot) === null ? NO_BASE_REASON : null;
}

function noCommitsReason(snapshot: VcsSnapshot): string | null {
  const target = prTarget(snapshot);
  if (target === null) return NO_BASE_REASON;
  return commitsAhead(snapshot) === 0 ? `${target.branch} has no commits ahead of ${target.base}` : null;
}

export function createPrBlockedReason(snapshot: VcsSnapshot): string | null {
  const reason = actionBlockedReason(snapshot) ?? formReason(snapshot);
  if (reason !== null) return reason;
  if (snapshot.generatingPr) return "The pull request is being written";
  const commits = noCommitsReason(snapshot);
  if (commits !== null) return commits;
  return prDraftOf(snapshot).title.trim() === "" ? "Write a pull request title first" : null;
}
