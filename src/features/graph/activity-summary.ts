import type { NodeActivity } from "./activity-state";
import type { FolderActivity } from "./label-text";

export interface HudStats {
  readonly files: number;
  readonly visited: number;
  readonly edited: number;
  readonly readOnly: number;
  readonly turnLines: number;
}

type Nodes = ReadonlyMap<string, NodeActivity>;

function wasVisited(activity: NodeActivity): boolean {
  return activity.reads + activity.edits > 0;
}

/** The headline numbers for the toolbar: how much of the project the agent has seen and changed. */
export function hudStats(nodes: Nodes, turnLines: number, files: number): HudStats {
  let visited = 0;
  let edited = 0;
  for (const activity of nodes.values()) {
    if (!wasVisited(activity)) continue;
    visited += 1;
    if (activity.edits > 0) edited += 1;
  }
  return { files, visited, edited, readOnly: visited - edited, turnLines };
}

/** What the agent has done inside each hub, counting a file under the hub that owns it. */
export function folderActivity(nodes: Nodes, hubOf: (fileId: string) => string | null): Map<string, FolderActivity> {
  const totals = new Map<string, { edited: number; readOnly: number }>();
  for (const [id, activity] of nodes) {
    const hub = wasVisited(activity) ? hubOf(id) : null;
    if (hub === null) continue;
    const entry = totals.get(hub) ?? { edited: 0, readOnly: 0 };
    if (activity.edits > 0) entry.edited += 1;
    else entry.readOnly += 1;
    totals.set(hub, entry);
  }
  return totals;
}

/** Files touched within the window, with when. */
export function recentlyTouched(nodes: Nodes, now: number, windowMs: number): Map<string, number> {
  const recent = new Map<string, number>();
  for (const [id, activity] of nodes) {
    if (now - activity.lastTouchedAt < windowMs) recent.set(id, activity.lastTouchedAt);
  }
  return recent;
}
