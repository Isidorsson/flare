import { FilePen, FilePlus, FileDiff, type LucideIcon } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "@/shared/ui/EmptyState";
import { Tooltip } from "@/shared/ui/Tooltip";

import type { AgentChangeKind, TimelineEntry } from "./files-types";
import { relativeTo } from "./paths";
import { groupByTurn } from "./timeline";
import { useFiles } from "./use-files";

const KIND_VIEW: Record<AgentChangeKind, { icon: LucideIcon; label: string; tone: string }> = {
  create: { icon: FilePlus, label: "Created", tone: "text-success" },
  update: { icon: FilePen, label: "Edited", tone: "text-warning" },
};

interface EntryButtonProps {
  entry: TimelineEntry;
  root: string | null;
  selected: boolean;
  onSelect: (id: string) => void;
}

function EntryButton({ entry, root, selected, onSelect }: EntryButtonProps) {
  const { icon: Icon, label, tone } = KIND_VIEW[entry.kind];
  const shownPath = root === null ? entry.path : relativeTo(root, entry.path);
  return (
    <Tooltip content="Show this edit as a diff" detail={entry.path}>
      <button
        type="button"
        aria-current={selected}
        onClick={() => {
          onSelect(entry.id);
        }}
        className={`flex h-7 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-surface-2 ${
          selected ? "bg-surface-3 text-fg" : "text-fg-muted"
        }`}
      >
        <Icon aria-hidden className={`size-3.5 shrink-0 ${tone}`} />
        <span className="min-w-0 flex-1 truncate">{shownPath}</span>
        <span className="shrink-0 text-[10px] text-fg-subtle">{label}</span>
      </button>
    </Tooltip>
  );
}

export function EditTimeline() {
  const changes = useFiles((state) => state.changes);
  const root = useFiles((state) => state.root);
  const active = useFiles((state) => state.active);
  const showChange = useFiles((state) => state.showChange);
  const groups = useMemo(() => groupByTurn(changes).reverse(), [changes]);
  const activeId = active?.kind === "diff" ? active.changeId : null;

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-6">
        <EmptyState
          icon={FileDiff}
          title="No edits yet"
          description="Every file the agent changes is listed here by turn. Select one to see its diff."
        />
      </div>
    );
  }

  return (
    <div className="py-1">
      {groups.map((group) => (
        <section key={group.turnId} aria-label={group.label}>
          <h3 className="flex items-center justify-between px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
            {group.label}
            <span className="font-normal normal-case">
              {group.entries.length} {group.entries.length === 1 ? "edit" : "edits"}
            </span>
          </h3>
          {group.entries.map((entry) => (
            <EntryButton key={entry.id} entry={entry} root={root} selected={entry.id === activeId} onSelect={showChange} />
          ))}
        </section>
      ))}
    </div>
  );
}
