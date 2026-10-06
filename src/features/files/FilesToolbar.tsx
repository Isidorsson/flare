import { FileDiff, FolderTree, Radio, type LucideIcon } from "lucide-react";

import { Tooltip } from "@/shared/ui/Tooltip";

import type { SidePane } from "./files-types";
import { useFiles } from "./use-files";

interface PaneButtonProps {
  pane: SidePane;
  icon: LucideIcon;
  label: string;
  hint: string;
  count?: number;
}

function PaneButton({ pane, icon: Icon, label, hint, count }: PaneButtonProps) {
  const selected = useFiles((state) => state.pane === pane);
  const setPane = useFiles((state) => state.setPane);
  const tone = selected ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg";
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => {
          setPane(pane);
        }}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${tone}`}
      >
        <Icon aria-hidden className="size-3.5" />
        {label}
        {count !== undefined && count > 0 ? (
          <span className="rounded-full bg-accent-soft px-1.5 text-[10px] leading-4 text-accent">{count}</span>
        ) : null}
      </button>
    </Tooltip>
  );
}

function FollowSwitch() {
  const follow = useFiles((state) => state.follow);
  const setFollow = useFiles((state) => state.setFollow);
  return (
    <Tooltip content="Follow the agent in the editor" detail="Opens each file it reads or edits and shows the work live">
      <button
        type="button"
        role="switch"
        aria-checked={follow}
        onClick={() => {
          setFollow(!follow);
        }}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
          follow ? "text-accent" : "text-fg-muted hover:text-fg"
        }`}
      >
        <Radio aria-hidden className="size-3.5" />
        Follow agent
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${follow ? "bg-accent" : "bg-border-strong"}`}
        >
          <span
            className={`absolute top-0.5 size-2.5 rounded-full bg-bg transition-[left] ${follow ? "left-3" : "left-0.5"}`}
          />
        </span>
      </button>
    </Tooltip>
  );
}

export function FilesToolbar() {
  const changeCount = useFiles((state) => state.changes.length);
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <div className="flex items-center gap-1">
        <PaneButton pane="explorer" icon={FolderTree} label="Explorer" hint="Browse the project's files" />
        <PaneButton
          pane="timeline"
          icon={FileDiff}
          label="Edits"
          hint="List the files the agent changed, by turn"
          count={changeCount}
        />
      </div>
      <FollowSwitch />
    </div>
  );
}
