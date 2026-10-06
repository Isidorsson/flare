import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";

import { treeKeyAction } from "./tree-keys";
import { flattenTree, type TreeRow } from "./tree-rows";
import { useFiles } from "./use-files";

const INDENT_PX = 12;
const BASE_PADDING_PX = 8;

type EntryRow = Extract<TreeRow, { type: "entry" }>;

interface EntryRowViewProps {
  row: EntryRow;
  selected: boolean;
  touchedByAgent: boolean;
  focusable: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string, pinned: boolean) => void;
}

function EntryRowView({ row, selected, touchedByAgent, focusable, onToggle, onOpen }: EntryRowViewProps) {
  const { entry } = row;
  const isDir = entry.kind === "dir";
  const Icon = isDir ? (row.expanded ? FolderOpen : Folder) : File;
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? row.expanded : undefined}
      tabIndex={focusable ? 0 : -1}
      data-path={entry.path}
      data-kind={entry.kind}
      title={entry.path}
      style={{ paddingLeft: BASE_PADDING_PX + row.depth * INDENT_PX }}
      onClick={() => {
        if (isDir) onToggle(entry.path);
        else onOpen(entry.path, false);
      }}
      onDoubleClick={() => {
        if (!isDir) onOpen(entry.path, true);
      }}
      className={`flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs transition-colors hover:bg-surface-2 ${
        selected ? "bg-surface-3 text-fg" : "text-fg-muted"
      }`}
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {isDir ? (row.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />) : null}
      </span>
      <Icon aria-hidden className={`size-3.5 shrink-0 ${isDir ? "text-fg-subtle" : "text-fg-muted"}`} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {touchedByAgent ? (
        <span role="img" aria-label="Edited by the agent" title="Edited by the agent" className="size-1.5 shrink-0 rounded-full bg-accent" />
      ) : null}
    </button>
  );
}

function StatusRow({ row }: { row: Extract<TreeRow, { type: "status" }> }) {
  const tone = row.tone === "error" ? "text-danger" : "text-fg-subtle";
  return (
    <div
      role="none"
      style={{ paddingLeft: BASE_PADDING_PX + row.depth * INDENT_PX + 20 }}
      className={`py-1 pr-2 text-xs ${tone}`}
    >
      {row.text}
    </div>
  );
}

function moveFocus(tree: HTMLElement, from: HTMLElement, step: 1 | -1) {
  const items = [...tree.querySelectorAll<HTMLElement>("[role=treeitem]")];
  items[items.indexOf(from) + step]?.focus();
}

export function FileTree() {
  const root = useFiles((state) => state.root);
  const phase = useFiles((state) => state.phase);
  const workspaceError = useFiles((state) => state.workspaceError);
  const dirs = useFiles((state) => state.dirs);
  const expanded = useFiles((state) => state.expanded);
  const active = useFiles((state) => state.active);
  const changes = useFiles((state) => state.changes);
  const toggleDir = useFiles((state) => state.toggleDir);
  const openFile = useFiles((state) => state.openFile);

  const rows = useMemo(() => (root === null ? [] : flattenTree(root, dirs, expanded)), [root, dirs, expanded]);
  const touched = useMemo(() => new Set(changes.map((change) => change.path)), [changes]);
  const activePath = active?.kind === "file" ? active.path : null;
  const firstEntryKey = rows.find((row) => row.type === "entry")?.key;

  if (phase === "error") {
    return <p className="p-3 text-xs text-danger">Could not open the folder: {workspaceError}</p>;
  }
  if (phase !== "ready") {
    return <p className="p-3 text-xs text-fg-subtle">Opening folder...</p>;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { target } = event;
    if (!(target instanceof HTMLElement) || target.getAttribute("role") !== "treeitem") return;
    const action = treeKeyAction(event.key, {
      isDir: target.dataset.kind === "dir",
      isOpen: target.getAttribute("aria-expanded") === "true",
    });
    if (action === null) return;
    event.preventDefault();
    if (action === "toggle") void toggleDir(target.dataset.path ?? "");
    else moveFocus(event.currentTarget, target, action === "next" ? 1 : -1);
  }

  return (
    <div role="tree" aria-label="Project files" onKeyDown={handleKeyDown} className="py-1">
      {rows.map((row) =>
        row.type === "entry" ? (
          <EntryRowView
            key={row.key}
            row={row}
            selected={row.entry.path === activePath}
            touchedByAgent={touched.has(row.entry.path)}
            focusable={row.key === firstEntryKey}
            onToggle={(path) => void toggleDir(path)}
            onOpen={(path, pinned) => void openFile(path, { preview: !pinned })}
          />
        ) : (
          <StatusRow key={row.key} row={row} />
        ),
      )}
    </div>
  );
}
