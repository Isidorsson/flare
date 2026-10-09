import { ChevronDown, GitBranch } from "lucide-react";
import { useId, useRef, useState } from "react";

import { anchorNameFor } from "@/shared/ui/anchor-name";
import { Tooltip } from "@/shared/ui/Tooltip";

import { BranchLists } from "./BranchLists";
import { DeleteBranchDialog } from "./DeleteBranchDialog";
import { NewBranchForm } from "./NewBranchForm";
import { useVcs } from "./use-vcs";
import type { VcsStatus } from "./vcs-schemas";
import { actionBlockedReason } from "./vcs-selectors";

function BranchMenuBody({ onClose }: { onClose: () => void }) {
  const branches = useVcs((state) => state.branches);
  const blockedReason = useVcs(actionBlockedReason);
  const switchBranch = useVcs((state) => state.switchBranch);
  const createBranch = useVcs((state) => state.createBranch);
  const deleteBranch = useVcs((state) => state.deleteBranch);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <>
      <BranchLists
        onSwitch={(branch) => {
          onClose();
          void switchBranch(branch.name);
        }}
        onRequestDelete={(branch) => {
          setPendingDelete(branch.name);
        }}
      />
      <NewBranchForm
        branches={branches}
        blockedReason={blockedReason}
        onCreate={(name) => {
          onClose();
          void createBranch(name);
        }}
      />
      {pendingDelete === null ? null : (
        <DeleteBranchDialog
          name={pendingDelete}
          onCancel={() => {
            setPendingDelete(null);
          }}
          onConfirm={(force) => {
            onClose();
            void deleteBranch(pendingDelete, force);
            setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}

/** The current branch as a button that opens the list: switch, create a new one, or delete a local one. */
export function BranchPicker({ status }: { status: VcsStatus }) {
  const menuId = useId();
  const anchor = anchorNameFor("branch-menu", menuId);
  const popover = useRef<HTMLDivElement>(null);
  const loadBranches = useVcs((state) => state.loadBranches);
  const label = status.branch ?? `Detached at ${status.head ?? "no commit"}`;
  const detail = status.branch === null ? "HEAD is not on a branch. Switch to one before committing work you want to keep" : status.upstream ?? "Not published yet";

  return (
    <>
      <Tooltip content="Switch or create a branch" detail={detail}>
        <button
          type="button"
          popoverTarget={menuId}
          style={{ anchorName: anchor }}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-xs text-fg transition-colors hover:bg-surface-3"
        >
          <GitBranch aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="min-w-0 truncate font-medium">{label}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </Tooltip>
      <div
        id={menuId}
        ref={popover}
        popover="auto"
        aria-label="Branches"
        onToggle={(event) => {
          if (event.newState === "open") void loadBranches();
        }}
        style={{ positionAnchor: anchor, positionArea: "bottom span-right" }}
        className="inset-auto m-0 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border-strong bg-surface-2 text-fg shadow-lg"
      >
        <BranchMenuBody
          onClose={() => {
            popover.current?.hidePopover();
          }}
        />
      </div>
    </>
  );
}
