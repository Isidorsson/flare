import { FileDiff, FolderTree, Radio, type LucideIcon } from "lucide-react";

import type { SidePane } from "./files-types";
import { useFiles } from "./use-files";

interface PaneButtonProps {
  pane: SidePane;
  icon: LucideIcon;
  label: string;
  count?: number;
}

function PaneButton({ pane, icon: Icon, label, count }: PaneButtonProps) {
  const selected = useFiles((state) => state.pane === pane);
  const setPane = useFiles((state) => state.setPane);
  const tone = selected ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg";
  return (
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
  );
}

function FollowSwitch() {
  const follow = useFiles((state) => state.follow);
  const setFollow = useFiles((state) => state.setFollow);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={follow}
      title="Open the files the agent reads and edits and show the work as it happens"
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
  );
}

export function FilesToolbar() {
  const changeCount = useFiles((state) => state.changes.length);
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <div className="flex items-center gap-1">
        <PaneButton pane="explorer" icon={FolderTree} label="Explorer" />
        <PaneButton pane="timeline" icon={FileDiff} label="Edits" count={changeCount} />
      </div>
      <FollowSwitch />
    </div>
  );
}
