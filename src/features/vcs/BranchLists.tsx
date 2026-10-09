import { useState } from "react";

import { BranchSection } from "./BranchRows";
import { groupBranches } from "./branch-model";
import { useVcs } from "./use-vcs";
import type { VcsBranch } from "./vcs-schemas";
import { actionBlockedReason } from "./vcs-selectors";

interface BranchListsProps {
  onSwitch: (branch: VcsBranch) => void;
  onRequestDelete: (branch: VcsBranch) => void;
}

/** A filter box over the local branches, then the remote ones that have no local branch yet. */
export function BranchLists({ onSwitch, onRequestDelete }: BranchListsProps) {
  const branches = useVcs((state) => state.branches);
  const loading = useVcs((state) => state.branchesLoading);
  const blockedReason = useVcs(actionBlockedReason);
  const [filter, setFilter] = useState("");
  const { local, remote } = groupBranches(branches, filter);

  return (
    <>
      <div className="p-1">
        <input
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          aria-label="Filter branches"
          placeholder="Filter branches"
          spellCheck={false}
          className="h-7 w-full rounded-md border border-border bg-surface-1 px-2 text-xs text-fg outline-none select-text placeholder:text-fg-subtle focus:border-border-strong"
        />
      </div>
      <div className="max-h-72 overflow-y-auto px-1 pb-1">
        <BranchSection
          title="Local"
          branches={local}
          blockedReason={blockedReason}
          onSwitch={onSwitch}
          onDelete={onRequestDelete}
        />
        <BranchSection title="Remote" branches={remote} blockedReason={blockedReason} onSwitch={onSwitch} />
        {local.length + remote.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-subtle">{loading ? "Loading branches" : "No branch matches"}</p>
        ) : null}
      </div>
    </>
  );
}
