import { ExternalLink, GitPullRequest } from "lucide-react";

import { ActionButton } from "./ActionButton";
import { openInBrowser } from "./open-url";
import { PrStateBadge } from "./PrStateBadge";
import type { PullRequest } from "./vcs-schemas";

/** The pull request that already exists for the branch. */
export function PrExisting({ pr }: { pr: PullRequest }) {
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-start gap-2">
        <GitPullRequest aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
        <p className="min-w-0 flex-1 text-xs break-words text-fg select-text">
          <span className="font-medium tabular-nums">#{pr.number}</span> {pr.title}
        </p>
        <PrStateBadge pr={pr} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-fg-subtle">into {pr.base}</span>
        <ActionButton
          label="Open in browser"
          icon={ExternalLink}
          hint="Open this pull request on GitHub"
          detail={pr.url}
          blockedReason={null}
          onPress={() => {
            openInBrowser(pr.url);
          }}
        />
      </div>
    </div>
  );
}
