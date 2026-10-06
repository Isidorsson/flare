import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";

import type { HeatEntry } from "./live/heat";
import { useHeatView } from "./live/use-heat";
import { treeKeyAction } from "./tree-keys";
import { flattenTree, type TreeRow } from "./tree-rows";
import { useFiles } from "./use-files";

const INDENT_PX = 12;
const BASE_PADDING_PX = 8;

type EntryRow = Extract<TreeRow, { type: "entry" }>;

interface EntryRowViewProps {
  row: EntryRow;
  selected: boolean;
  heat: HeatEntry | undefined;
  spark: boolean;
  focusable: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string, pinned: boolean) => void;
}

function rowTitle(path: string, heat: HeatEntry | undefined): string {
  if (heat === undefined) return path;
  return `${path}\n${heat.kind === "edit" ? "Edited" : "Read"} by the agent`;
}

function rowClassName(selected: boolean, heat: HeatEntry | undefined): string {
  const base = "relative flex h-6 w-full items-center gap-1.5 pr-2 text-left text-xs transition-colors hover:bg-surface-2";
  const heated = heat === undefined ? "" : "flare-heat";
  return `${base} ${heated} ${selected ? "bg-surface-3 text-fg" : "text-fg-muted"}`;
}

function heatAttributes(heat: HeatEntry | undefined) {
  return heat === undefined ? {} : { "data-heat": heat.step, "data-heat-kind": heat.kind };
}

function RowIcon({ row }: { row: EntryRow }) {
  if (row.entry.kind === "file") return <File aria-hidden className="size-3.5 shrink-0 text-fg-muted" />;
  const Icon = row.expanded ? FolderOpen : Folder;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />;
}

function Chevron({ row }: { row: EntryRow }) {
  if (row.entry.kind === "file") return null;
  return row.expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />;
}

/** The number of the file in the order the agent touched them, 1 being the latest. */
function RecencyBadge({ heat }: { heat: HeatEntry }) {
  if (heat.badge === null) return null;
  const tone = heat.kind === "edit" ? "bg-claude" : "bg-read";
  return (
    <span
      aria-label={`Touched by the agent ${String(heat.badge)} ${heat.badge === 1 ? "file" : "files"} ago`}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-semibold text-bg ${tone}`}
    >
      {heat.badge}
    </span>
  );
}

function EntryRowView({ row, selected, heat, spark, focusable, onToggle, onOpen }: EntryRowViewProps) {
  const { entry } = row;
  const isDir = entry.kind === "dir";
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
      title={rowTitle(entry.path, heat)}
      style={{ paddingLeft: BASE_PADDING_PX + row.depth * INDENT_PX }}
      onClick={() => {
        if (isDir) onToggle(entry.path);
        else onOpen(entry.path, false);
      }}
      onDoubleClick={() => {
        if (!isDir) onOpen(entry.path, true);
      }}
      {...heatAttributes(heat)}
      className={rowClassName(selected, heat)}
    >
      {spark ? <span aria-hidden className="flare-spark" /> : null}
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        <Chevron row={row} />
      </span>
      <RowIcon row={row} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {heat === undefined ? null : <RecencyBadge heat={heat} />}
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
  const toggleDir = useFiles((state) => state.toggleDir);
  const openFile = useFiles((state) => state.openFile);
  const heat = useHeatView();

  const rows = useMemo(() => (root === null ? [] : flattenTree(root, dirs, expanded)), [root, dirs, expanded]);
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
            heat={row.entry.kind === "file" ? heat.files.get(row.entry.path) : undefined}
            spark={row.entry.kind === "dir" && heat.sparks.has(row.entry.path)}
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
