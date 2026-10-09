import { SUBJECT_LIMIT } from "./commit-draft";
import type { PrDraft, PrInfoState } from "./pr-types";
import type { PullRequest } from "./vcs-schemas";

export const GH_INSTALL_COMMAND = "winget install GitHub.cli";
export const GH_LOGIN_COMMAND = "gh auth login";

export const PR_TITLE_LIMIT = SUBJECT_LIMIT;

/** Branches taken for the base when `gh` cannot say what the default is (it is missing or signed out). */
export const FALLBACK_BASES: readonly string[] = ["main", "master"];

export const EMPTY_PR_DRAFT: PrDraft = { base: null, title: "", body: "", isDraft: false };

export const INITIAL_PR: PrInfoState = { info: null, branch: null, loading: false, ahead: null };

/** One draft per branch, so the title written for one branch never lands on another. */
export function prDraftKey(root: string, branch: string): string {
  return `${root}\n${branch}`;
}

export type PrStateLabel = "open" | "draft" | "merged" | "closed";

export function prStateLabel(pr: Pick<PullRequest, "state" | "isDraft">): PrStateLabel {
  return pr.state === "open" && pr.isDraft ? "draft" : pr.state;
}

export const PR_STATE_DETAILS: Record<PrStateLabel, string> = {
  open: "Open and ready for review",
  draft: "A draft: not ready for review yet",
  merged: "Merged into the base branch",
  closed: "Closed without merging",
};
