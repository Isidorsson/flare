import type { PrInfo } from "./vcs-schemas";

/** What the user is writing for the pull request of one branch. `base` null means the repository's default. */
export interface PrDraft {
  base: string | null;
  title: string;
  body: string;
  isDraft: boolean;
}

/** What the last look at the commits of a branch found, so Create can say there is nothing to open a pull request for. */
export interface PrAhead {
  branch: string;
  base: string;
  /** The commit the branch was at, so a newer commit makes this answer stale. */
  head: string | null;
  commits: number;
}

export interface PrInfoState {
  /** The last answer of `gh`; null until the first one for this folder. */
  info: PrInfo | null;
  /** The branch `info.current` belongs to. */
  branch: string | null;
  loading: boolean;
  ahead: PrAhead | null;
}

/** What the Pull request section shows. */
export type PrViewKind = "hidden" | "checking" | "failed" | "ghMissing" | "signedOut" | "existing" | "form";
