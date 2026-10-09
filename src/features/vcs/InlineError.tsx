import { CircleAlert, X } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";

import { useVcs } from "./use-vcs";
import type { VcsAction } from "./vcs-types";

const FAILURES: Record<VcsAction, string> = {
  refresh: "Could not read the git status",
  branches: "Could not list the branches",
  stage: "Could not stage",
  unstage: "Could not unstage",
  discard: "Could not discard",
  commit: "Commit failed",
  commitAndPush: "Commit and push failed",
  fetch: "Fetch failed",
  pull: "Pull failed",
  push: "Push failed",
  switchBranch: "Could not switch branch",
  createBranch: "Could not create the branch",
  deleteBranch: "Could not delete the branch",
  generate: "Could not generate a message",
  loadPr: "Could not read the pull request state",
  generatePr: "Could not write the pull request",
  createPr: "Could not create the pull request",
};

function ErrorBanner({ action, message }: { action: VcsAction; message: string }) {
  const dismissError = useVcs((state) => state.dismissError);
  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-t border-danger/30 bg-surface-2 py-1.5 pr-1 pl-3 text-xs text-fg select-text"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        <span className="font-medium">{FAILURES[action]}.</span> {message}
      </p>
      <IconButton
        icon={X}
        label="Dismiss this message"
        className="size-6"
        onClick={() => {
          dismissError(action);
        }}
      />
    </div>
  );
}

interface InlineErrorProps {
  /** The actions whose failures this spot shows. */
  actions: readonly VcsAction[];
}

/** Failures stay on screen, next to the controls that caused them, until dismissed or the action runs again. */
export function InlineError({ actions }: InlineErrorProps) {
  const errors = useVcs((state) => state.errors);
  return (
    <>
      {actions.map((action) => {
        const message = errors[action];
        return message === undefined ? null : <ErrorBanner key={action} action={action} message={message} />;
      })}
    </>
  );
}
