import { GitBranchPlus } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { ActionButton } from "./ActionButton";
import { branchNameProblem } from "./branch-model";
import type { VcsBranch } from "./vcs-schemas";

interface NewBranchFormProps {
  branches: readonly VcsBranch[];
  blockedReason: string | null;
  /** Called with the trimmed name; the form clears itself afterwards. */
  onCreate: (name: string) => void;
}

export function NewBranchForm({ branches, blockedReason, onCreate }: NewBranchFormProps) {
  const [name, setName] = useState("");
  const problem = branchNameProblem(name, branches);
  const reason = blockedReason ?? problem;

  function create() {
    if (reason !== null) return;
    onCreate(name.trim());
    setName("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    create();
  }

  return (
    <div className="space-y-1 border-t border-border p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={onKeyDown}
          aria-label="New branch name"
          placeholder="New branch name"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2 font-mono text-xs text-fg outline-none select-text placeholder:font-sans placeholder:text-fg-subtle focus:border-border-strong"
        />
        <ActionButton
          label="Create"
          icon={GitBranchPlus}
          hint="Create this branch from the current commit and switch to it"
          blockedReason={reason}
          onPress={create}
        />
      </div>
      {name.trim() !== "" && problem !== null ? <p className="text-[11px] text-warning">{problem}</p> : null}
    </div>
  );
}
