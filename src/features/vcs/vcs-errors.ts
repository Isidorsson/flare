import { describeError } from "@/shared/lib/describe-error";

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
};

/** What to tell the user about a failed git action: a plain sentence for the codes Flare knows, git's own message otherwise. */
export function describeVcsError(error: unknown): string {
  if (error instanceof VcsCommandError) {
    const friendly = FRIENDLY[error.code];
    if (friendly !== undefined) return friendly(error.message);
  }
  return describeError(error);
}
