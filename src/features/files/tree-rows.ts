import type { DirState } from "./files-types";
import type { DirEntry } from "./fs-schemas";

export type TreeRow =
  | { type: "entry"; key: string; depth: number; entry: DirEntry; expanded: boolean }
  | { type: "status"; key: string; depth: number; tone: "muted" | "error"; text: string };

interface Walk {
  rows: TreeRow[];
  dirs: Readonly<Record<string, DirState>>;
  expanded: Readonly<Record<string, true>>;
}

/** Flattens the lazily loaded tree into the rows that are currently visible. */
export function flattenTree(
  root: string,
  dirs: Walk["dirs"],
  expanded: Walk["expanded"],
): TreeRow[] {
  const walk: Walk = { rows: [], dirs, expanded };
  appendDirectory(walk, root, 0);
  return walk.rows;
}

function status(key: string, depth: number, tone: "muted" | "error", text: string): TreeRow {
  return { type: "status", key, depth, tone, text };
}

function appendDirectory(walk: Walk, path: string, depth: number) {
  const dir = walk.dirs[path];
  if (dir === undefined || dir.status === "loading") {
    walk.rows.push(status(`${path}#loading`, depth, "muted", "Loading..."));
    return;
  }
  if (dir.status === "error") {
    walk.rows.push(status(`${path}#error`, depth, "error", dir.message));
    return;
  }
  for (const entry of dir.entries) {
    const isOpen = entry.kind === "dir" && walk.expanded[entry.path] === true;
    walk.rows.push({ type: "entry", key: entry.path, depth, entry, expanded: isOpen });
    if (isOpen) appendDirectory(walk, entry.path, depth + 1);
  }
  if (dir.truncated) walk.rows.push(status(`${path}#truncated`, depth, "muted", "Showing the first entries only"));
  if (dir.entries.length === 0) walk.rows.push(status(`${path}#empty`, depth, "muted", "Empty folder"));
}
