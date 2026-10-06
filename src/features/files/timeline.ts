import type { TimelineEntry } from "./files-types";

export interface TurnGroup {
  turnId: string;
  label: string;
  entries: TimelineEntry[];
}

/** Groups edits by the turn that made them, in the order the turns first appeared. */
export function groupByTurn(changes: readonly TimelineEntry[]): TurnGroup[] {
  const groups = new Map<string, TurnGroup>();
  for (const entry of changes) {
    const existing = groups.get(entry.turnId);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    groups.set(entry.turnId, { turnId: entry.turnId, label: `Turn ${groups.size + 1}`, entries: [entry] });
  }
  return [...groups.values()];
}
