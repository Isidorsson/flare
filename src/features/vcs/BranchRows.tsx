import { Check, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { switchTargetLabel } from "./branch-model";
import type { VcsBranch } from "./vcs-schemas";

function ignoreClick(event: MouseEvent) {
  event.preventDefault();
}

interface BranchRowProps {
  branch: VcsBranch;
  blockedReason: string | null;
  onSwitch: (branch: VcsBranch) => void;
  onDelete: ((branch: VcsBranch) => void) | undefined;
}

function CurrentRow({ branch }: { branch: VcsBranch }) {
  return (
    <li className="flex h-7 items-center gap-2 px-2 text-xs text-fg">
      <Check aria-label="Current branch" className="size-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
    </li>
  );
}

function BranchRow({ branch, blockedReason, onSwitch, onDelete }: BranchRowProps) {
  const blocked = blockedReason !== null;
  return (
    <li className="flex h-7 items-center gap-1 rounded pr-1 pl-2 hover:bg-surface-3">
      <Tooltip content={switchTargetLabel(branch)} detail={blockedReason ?? branch.upstream ?? undefined} side="right">
        <button
          type="button"
          aria-disabled={blocked || undefined}
          onClick={
            blocked
              ? ignoreClick
              : () => {
                  onSwitch(branch);
                }
          }
          className={`flex min-w-0 flex-1 items-center gap-2 pl-5.5 text-left text-xs text-fg ${blocked ? "opacity-40" : ""}`}
        >
          <span className="min-w-0 truncate font-mono">{branch.name}</span>
        </button>
      </Tooltip>
      {onDelete === undefined ? null : (
        <IconButton
          icon={Trash2}
          label="Delete this branch"
          detail="Asks first. Removes the local branch only"
          disabledReason={blockedReason ?? undefined}
          className="size-6"
          onClick={() => {
            onDelete(branch);
          }}
        />
      )}
    </li>
  );
}

interface BranchSectionProps {
  title: string;
  branches: readonly VcsBranch[];
  blockedReason: string | null;
  onSwitch: (branch: VcsBranch) => void;
  /** Rows offer a delete button only when this is given. */
  onDelete?: (branch: VcsBranch) => void;
}

export function BranchSection({ title, branches, blockedReason, onSwitch, onDelete }: BranchSectionProps) {
  if (branches.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{title}</h3>
      <ul>
        {branches.map((branch) =>
          branch.current ? (
            <CurrentRow key={branch.name} branch={branch} />
          ) : (
            <BranchRow
              key={branch.name}
              branch={branch}
              blockedReason={blockedReason}
              onSwitch={onSwitch}
              onDelete={onDelete}
            />
          ),
        )}
      </ul>
    </section>
  );
}
