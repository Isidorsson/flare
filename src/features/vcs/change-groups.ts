import type { Change, VcsFile } from "./vcs-schemas";
import type { ChangeRow, FileSelection } from "./vcs-types";

export interface FileGroups {
  staged: ChangeRow[];
  unstaged: ChangeRow[];
}

// A conflicted file is listed once, under Changes: staging it is how the conflict gets resolved.
function stagedChange(file: VcsFile): Change | null {
  if (file.staged === null || file.staged === "conflicted" || file.unstaged === "conflicted") return null;
  return file.staged;
}

function worktreeChange(file: VcsFile): Change | null {
  if (file.unstaged !== null) return file.unstaged;
  return file.staged === "conflicted" ? "conflicted" : null;
}

function rowOf(file: VcsFile, change: Change, staged: boolean): ChangeRow {
  return { path: file.path, origPath: change === "renamed" ? file.origPath : null, change, staged };
}

/** Splits git's one-entry-per-file status into the Staged and Changes lists; a partly staged file is in both. */
export function groupFiles(files: readonly VcsFile[]): FileGroups {
  const staged: ChangeRow[] = [];
  const unstaged: ChangeRow[] = [];
  for (const file of files) {
    const stagedKind = stagedChange(file);
    if (stagedKind !== null) staged.push(rowOf(file, stagedKind, true));
    const worktreeKind = worktreeChange(file);
    if (worktreeKind !== null) unstaged.push(rowOf(file, worktreeKind, false));
  }
  return { staged, unstaged };
}

export function stagePaths(rows: readonly ChangeRow[]): string[] {
  return rows.map((row) => row.path);
}

/** A staged rename needs both paths, or the old one would stay staged as a deletion. */
export function unstagePaths(rows: readonly ChangeRow[]): string[] {
  return rows.flatMap((row) => (row.origPath === null ? [row.path] : [row.path, row.origPath]));
}

/** Why a change cannot be thrown away, or null. Discarding puts the file back to the index. */
export function discardBlockedReason(change: Change): string | null {
  if (change === "untracked") return "Git does not track this file yet, so there is nothing to restore";
  if (change === "conflicted") return "Resolve the merge conflict first";
  return null;
}

export function discardPaths(rows: readonly ChangeRow[]): string[] {
  return rows.filter((row) => discardBlockedReason(row.change) === null).map((row) => row.path);
}

export function conflictCount(rows: readonly ChangeRow[]): number {
  return rows.filter((row) => row.change === "conflicted").length;
}

/** Keeps the selection through a refresh: a file that moved between the lists is followed, a file that is gone is dropped. */
export function reconcileSelection(selection: FileSelection | null, files: readonly VcsFile[]): FileSelection | null {
  if (selection === null) return null;
  const groups = groupFiles(files);
  const listed = (rows: readonly ChangeRow[]) => rows.some((row) => row.path === selection.path);
  if (listed(selection.staged ? groups.staged : groups.unstaged)) return selection;
  if (listed(selection.staged ? groups.unstaged : groups.staged)) return { path: selection.path, staged: !selection.staged };
  return null;
}
