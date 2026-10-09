import { BranchPicker } from "./BranchMenu";
import { InlineError } from "./InlineError";
import { SyncChip, SyncControls } from "./SyncControls";
import type { VcsStatus } from "./vcs-schemas";
import type { VcsAction } from "./vcs-types";

const BAR_ERRORS: readonly VcsAction[] = [
  "refresh",
  "branches",
  "switchBranch",
  "createBranch",
  "deleteBranch",
  "fetch",
  "pull",
  "push",
];

/** The branch picker, how far the branch is from its upstream, and Fetch / Pull / Push. */
export function BranchBar({ status }: { status: VcsStatus }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex h-10 items-center gap-1.5 px-1.5">
        <BranchPicker status={status} />
        <SyncChip status={status} />
        <SyncControls status={status} />
      </div>
      <InlineError actions={BAR_ERRORS} />
    </div>
  );
}
