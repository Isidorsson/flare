import type { DirState, OpenFile } from "./files-types";
import type { WatchBatch } from "./fs-schemas";
import { normalizePath, parentDir } from "./paths";

export interface WatchView {
  root: string | null;
  dirs: Record<string, DirState>;
  files: Record<string, OpenFile>;
}

export interface WatchPlan {
  reloadDirs: string[];
  syncFiles: string[];
  deletedFiles: string[];
}

/**
 * Decides what a watcher batch means for the UI: which loaded directory
 * listings are stale and which open buffers must be re-read or flagged.
 * Returns null for a batch that belongs to a different workspace.
 */
export function planWatchBatch(view: WatchView, batch: WatchBatch): WatchPlan | null {
  if (view.root === null || normalizePath(batch.root) !== view.root) return null;
  if (batch.rescan) return rescanPlan(view);

  const reloadDirs = new Set<string>();
  const syncFiles = new Set<string>();
  const deletedFiles = new Set<string>();
  for (const change of batch.changes) {
    const path = normalizePath(change.path);
    const parent = parentDir(path);
    if (change.kind !== "modify" && parent !== null && view.dirs[parent] !== undefined) reloadDirs.add(parent);
    if (view.files[path] === undefined) continue;
    (change.kind === "remove" ? deletedFiles : syncFiles).add(path);
  }
  return { reloadDirs: [...reloadDirs], syncFiles: [...syncFiles], deletedFiles: [...deletedFiles] };
}

function rescanPlan(view: WatchView): WatchPlan {
  const syncFiles = Object.values(view.files)
    .filter((file) => file.status === "ready")
    .map((file) => file.path);
  return { reloadDirs: Object.keys(view.dirs), syncFiles, deletedFiles: [] };
}
