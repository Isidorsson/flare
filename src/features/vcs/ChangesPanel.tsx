import { FolderOpen, GitBranch, LoaderCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/shared/ui/EmptyState";

import { ActionButton } from "./ActionButton";
import { BranchBar } from "./BranchBar";
import { CommitBox } from "./CommitBox";
import { DiffPane } from "./DiffPane";
import { FileSections } from "./FileSections";
import { InlineError } from "./InlineError";
import { useVcs } from "./use-vcs";
import type { VcsStatus } from "./vcs-schemas";

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full w-full items-center justify-center">{children}</div>;
}

function RepoView({ status }: { status: VcsStatus }) {
  return (
    <div className="@container h-full">
      <div className="flex h-full min-h-0 flex-col @2xl:flex-row">
        <div className="flex min-h-0 flex-1 flex-col border-border @2xl:w-80 @2xl:flex-none @2xl:border-r">
          <BranchBar status={status} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileSections status={status} />
          </div>
          <CommitBox />
        </div>
        <DiffPane />
      </div>
    </div>
  );
}

function Unavailable() {
  const failed = useVcs((state) => state.errors.refresh !== undefined);
  const refresh = useVcs((state) => state.refresh);
  if (!failed) {
    return (
      <Centered>
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          Reading the git status
        </p>
      </Centered>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <InlineError actions={["refresh"]} />
      <div className="flex justify-center">
        <ActionButton
          label="Try again"
          icon={RotateCw}
          hint="Read the git status again"
          blockedReason={null}
          onPress={() => {
            void refresh();
          }}
        />
      </div>
    </div>
  );
}

/** Stage, commit, branch and sync the open folder with git. */
export function ChangesPanel() {
  const root = useVcs((state) => state.root);
  const status = useVcs((state) => state.status);

  if (root === null) {
    return (
      <Centered>
        <EmptyState
          icon={FolderOpen}
          title="No folder open"
          description="Open a project folder to stage, commit and push its changes."
        />
      </Centered>
    );
  }
  if (status === null) return <Unavailable />;
  if (!status.isRepo) {
    return (
      <Centered>
        <EmptyState
          icon={GitBranch}
          title="Git is not set up in this folder"
          description="This folder is not a git repository yet. Run git init in the terminal, then come back to commit here."
        />
      </Centered>
    );
  }
  return <RepoView status={status} />;
}
