import { Tooltip } from "@/shared/ui/Tooltip";

import { PR_STATE_DETAILS, prStateLabel, type PrStateLabel } from "./pr-model";
import type { PullRequest } from "./vcs-schemas";

const STYLES: Record<PrStateLabel, string> = {
  open: "bg-success/15 text-success",
  draft: "bg-surface-3 text-fg-muted",
  merged: "bg-accent-soft text-accent",
  closed: "bg-danger/15 text-danger",
};

/** open, draft, merged or closed, as a small pill. */
export function PrStateBadge({ pr }: { pr: PullRequest }) {
  const label = prStateLabel(pr);
  return (
    <Tooltip content={`This pull request is ${label}`} detail={PR_STATE_DETAILS[label]}>
      <span tabIndex={0} className={`shrink-0 rounded-full px-2 text-[11px] leading-5 ${STYLES[label]}`}>
        {label}
      </span>
    </Tooltip>
  );
}
