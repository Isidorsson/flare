import { Tooltip } from "@/shared/ui/Tooltip";

import { baseBranchNames } from "./branch-model";
import { FIELD } from "./field-style";
import { currentBranchOf, selectedBase } from "./pr-selectors";
import { useVcs } from "./use-vcs";

/** The branch the pull request merges into: the repository's default until another is picked. */
export function PrBasePicker() {
  const branches = useVcs((state) => state.branches);
  const branch = useVcs(currentBranchOf);
  const defaultBase = useVcs((state) => state.pr.info?.defaultBase ?? null);
  const base = useVcs(selectedBase);
  const setPrBase = useVcs((state) => state.setPrBase);
  const names = baseBranchNames(branches, branch, [defaultBase, base]);

  return (
    <label className="flex items-center gap-2 text-[11px] text-fg-subtle">
      <span>Into</span>
      <Tooltip
        content="The branch to merge into"
        detail={defaultBase === null ? undefined : `${defaultBase} is the repository's default branch`}
        side="top"
      >
        <select
          value={base ?? ""}
          onChange={(event) => {
            setPrBase(event.target.value);
          }}
          aria-label="Base branch"
          className={`${FIELD} h-8 min-w-0 flex-1 font-mono`}
        >
          {base === null ? <option value="">Choose a branch</option> : null}
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Tooltip>
    </label>
  );
}
