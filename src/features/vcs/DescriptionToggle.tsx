import { Tooltip } from "@/shared/ui/Tooltip";

import { useVcs } from "./use-vcs";
import { draftOf } from "./vcs-selectors";

/** Whether Generate also writes a description, not just the subject line. */
export function DescriptionToggle() {
  const includeBody = useVcs((state) => draftOf(state).includeBody);
  const setIncludeBody = useVcs((state) => state.setIncludeBody);
  return (
    <Tooltip
      content="Also generate a description"
      detail="Off: only the subject line is written. On: a short explanation of why is added below it"
      side="top"
    >
      <button
        type="button"
        role="switch"
        aria-checked={includeBody}
        onClick={() => {
          setIncludeBody(!includeBody);
        }}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
          includeBody ? "text-accent" : "text-fg-muted hover:text-fg"
        }`}
      >
        with description
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${includeBody ? "bg-accent" : "bg-border-strong"}`}
        >
          <span
            className={`absolute top-0.5 size-2.5 rounded-full bg-bg transition-[left] ${includeBody ? "left-3" : "left-0.5"}`}
          />
        </span>
      </button>
    </Tooltip>
  );
}
