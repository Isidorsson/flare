import type { TimelineEntry } from "../files-types";
import { diffLines, type LineHunk } from "./line-diff";

export interface TurnFile {
  path: string;
  kind: "create" | "edit";
  added: number;
  removed: number;
}

export interface TurnSummary {
  files: TurnFile[];
  added: number;
  removed: number;
}

export interface LineSpan {
  start: number;
  end: number;
}

/** What to mark in the margin of a file for the changes of one turn. */
export interface TurnMarks {
  added: LineSpan[];
  // Lines where something was removed, as the line that now follows the removal.
  removedAt: number[];
}

interface NetChange {
  first: TimelineEntry;
  last: TimelineEntry;
}

// All of a turn's edits to one file add up to a single change from its first before to its last after.
function netChanges(changes: readonly TimelineEntry[], turnId: string | null): Map<string, NetChange> {
  const byPath = new Map<string, NetChange>();
  if (turnId === null) return byPath;
  for (const entry of changes) {
    if (entry.turnId !== turnId) continue;
    const known = byPath.get(entry.path);
    byPath.set(entry.path, { first: known?.first ?? entry, last: entry });
  }
  return byPath;
}

function netHunks({ first, last }: NetChange): LineHunk[] {
  return diffLines(first.before ?? "", last.after);
}

export function summarizeTurn(changes: readonly TimelineEntry[], turnId: string | null): TurnSummary {
  const files: TurnFile[] = [];
  for (const [path, change] of netChanges(changes, turnId)) {
    const hunks = netHunks(change);
    files.push({
      path,
      kind: change.first.kind === "create" ? "create" : "edit",
      added: hunks.reduce((sum, hunk) => sum + hunk.newCount, 0),
      removed: hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0),
    });
  }
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

/** The margin marks for one file, or null when the turn left it alone. */
export function turnMarks(changes: readonly TimelineEntry[], turnId: string | null, path: string): TurnMarks | null {
  const change = netChanges(changes, turnId).get(path);
  if (change === undefined) return null;
  const hunks = netHunks(change);
  return {
    added: hunks.filter((hunk) => hunk.newCount > 0).map((hunk) => ({ start: hunk.newStart, end: hunk.newStart + hunk.newCount - 1 })),
    removedAt: hunks.filter((hunk) => hunk.oldCount > 0).map((hunk) => hunk.newStart),
  };
}

/** The oldest change of the file in the turn through the newest, for replaying it. */
export function turnReplay(changes: readonly TimelineEntry[], turnId: string | null, path: string) {
  const change = netChanges(changes, turnId).get(path);
  return change === undefined ? null : { before: change.first.before, after: change.last.after };
}
