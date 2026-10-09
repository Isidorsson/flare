import { describeError } from "@/shared/lib/describe-error";

import { GH_INSTALL_COMMAND, GH_LOGIN_COMMAND } from "./pr-model";
import { VcsCommandError } from "./vcs-schemas";

// The codes the vcs commands add to whatever git itself reports; git's own failures come through as their message.
const FRIENDLY: Record<string, (message: string) => string> = {
  invalid_request: (message) => `Flare sent git a request it cannot run (${message}). This is a bug in Flare.`,
  not_a_repository: () => "This folder is not a git repository.",
  empty_message: () => "The commit message is empty. Write a subject first.",
  nothing_staged: () => "Nothing is staged. Stage at least one file to commit.",
  nothing_to_describe: () => "There are no changes to write a message about.",
  detached_head: () => "HEAD is not on a branch. Switch to a branch first.",
  no_remote: () => "This repository has no remote. Add one in the terminal with git remote add, then try again.",
  no_upstream: () => "This branch has no upstream branch yet. Push it once to publish it and set the upstream.",
  gh_missing: () => `The GitHub CLI (gh) is not installed. Run ${GH_INSTALL_COMMAND} in a terminal, then restart Flare.`,
  gh_unauthenticated: () => `The GitHub CLI is not signed in. Run ${GH_LOGIN_COMMAND} in a terminal, then try again.`,
  no_commits: () => "This branch has no commits ahead of the base branch, so there is nothing to open a pull request for. Commit your work first.",
  on_base_branch: () => "You are on the base branch. Switch to a feature branch to open a pull request.",
};

/** What to tell the user about a failed git action: a plain sentence for the codes Flare knows, git's own message otherwise. */
export function describeVcsError(error: unknown): string {
  if (error instanceof VcsCommandError) {
    const friendly = FRIENDLY[error.code];
    if (friendly !== undefined) return friendly(error.message);
  }
  return describeError(error);
}
