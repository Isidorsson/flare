import type { PrDraft, PrInfoState } from "./pr-types";
import type { Change, FileDiff, PrCommit, VcsBranch, VcsStatus } from "./vcs-schemas";

/** What the commit message generator is given: the diff to describe and style hints. */
export interface CommitMessageInput {
  stat: string;
  patch: string;
  truncated: boolean;
  recentSubjects: string[];
  /** Bodies of the latest commits that have one, the style to follow for a description. */
  recentBodies: string[];
  /** The current branch, a hint for the type and scope; null while HEAD is detached. */
  branch: string | null;
  includeBody: boolean;
}

export interface GeneratedMessage {
  subject: string;
  body: string | null;
}

/** Injected from outside so this feature never depends on the agent bridge: see `configureVcs`. */
export type CommitMessageGenerator = (input: CommitMessageInput) => Promise<GeneratedMessage>;

/** What the pull request generator is given: the commits to summarise and how far the diff reaches. */
export interface PullRequestInput {
  branch: string;
  base: string;
  /** Oldest first. */
  commits: PrCommit[];
  stat: string;
  truncated: boolean;
}

export interface GeneratedPullRequest {
  title: string;
  body: string;
}

export type PullRequestGenerator = (input: PullRequestInput) => Promise<GeneratedPullRequest>;

/** Actions that change the repository. One runs at a time, so two never fight over git's index lock. */
export type MutatingAction =
  | "stage"
  | "unstage"
  | "discard"
  | "commit"
  | "commitAndPush"
  | "fetch"
  | "pull"
  | "push"
  | "switchBranch"
  | "createBranch"
  | "deleteBranch"
  | "createPr";

/** Every action that can fail and show an error: the mutating ones and the ones that only read. */
export type VcsAction = MutatingAction | "refresh" | "branches" | "generate" | "loadPr" | "generatePr";

export interface CommitDraft {
  subject: string;
  description: string;
  includeBody: boolean;
}

/** A file in one of the two lists. A partly staged file can be listed in both. */
export interface FileSelection {
  path: string;
  staged: boolean;
}

export interface ChangeRow {
  path: string;
  /** The old path of a staged rename. */
  origPath: string | null;
  change: Change;
  staged: boolean;
}

export type DiffState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; diff: FileDiff; revision: number }
  | { kind: "error"; message: string };

export interface StoreAccess {
  get(): VcsSnapshot;
  set(update: (state: VcsSnapshot) => Partial<VcsSnapshot>): void;
}

export interface VcsSnapshot {
  root: string | null;
  /** Null until the first answer for the current root. */
  status: VcsStatus | null;
  branches: VcsBranch[];
  branchesLoading: boolean;
  selection: FileSelection | null;
  diff: DiffState;
  /** Commit drafts by workspace root; they last until the app closes. */
  drafts: Record<string, CommitDraft>;
  busy: MutatingAction | null;
  generating: boolean;
  canGenerate: boolean;
  pr: PrInfoState;
  /** Pull request drafts by workspace root and branch; they last until the app closes. */
  prDrafts: Record<string, PrDraft>;
  /** Whether the Pull request section is open; it stays as it was when the folder or the tab changes. */
  prExpanded: boolean;
  generatingPr: boolean;
  canGeneratePr: boolean;
  errors: Partial<Record<VcsAction, string>>;
}
