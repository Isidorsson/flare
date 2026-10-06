import type { NodeActivity } from "./activity-state";
import type { ActivityKind } from "./activity-types";
import { fileFolder } from "./directory-tree";
import type { GraphIndex } from "./graph-index";
import { baseName } from "./graph-paths";
import type { Role } from "./roles";

export const LIST_LIMIT = 8;

export interface FileRef {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
}

export interface ActivitySummary {
  readonly edits: number;
  readonly reads: number;
  readonly linesChanged: number;
  readonly lastKind: ActivityKind;
  readonly ago: string;
}

export interface InspectorModel {
  readonly id: string;
  readonly name: string;
  readonly folder: string;
  readonly role: Role;
  readonly changedThisTurn: boolean;
  readonly activity: ActivitySummary | null;
  readonly importers: readonly FileRef[];
  readonly importerCount: number;
  readonly imports: readonly FileRef[];
  readonly importCount: number;
  /** Everything that depends on this file, directly or not. */
  readonly affected: number;
  /** How many of those affected files are tests. */
  readonly tests: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const JUST_NOW_MS = 5 * SECOND;

export function formatAgo(elapsedMs: number): string {
  if (elapsedMs < JUST_NOW_MS) return "just now";
  if (elapsedMs < MINUTE) return `${Math.floor(elapsedMs / SECOND)}s ago`;
  if (elapsedMs < HOUR) return `${Math.floor(elapsedMs / MINUTE)}m ago`;
  return `${Math.floor(elapsedMs / HOUR)}h ago`;
}

export function fileRef(id: string): FileRef {
  return { id, name: baseName(id), folder: fileFolder(id) };
}

function newDependents(index: GraphIndex, frontier: readonly string[], seen: Set<string>): string[] {
  const found: string[] = [];
  for (const dependent of frontier.flatMap((current) => index.importers.get(current) ?? [])) {
    if (seen.has(dependent)) continue;
    seen.add(dependent);
    found.push(dependent);
  }
  return found;
}

/** Every file that reaches `id` through imports, nearest first; the file itself is not included. */
export function transitiveDependents(index: GraphIndex, id: string): string[] {
  const seen = new Set<string>([id]);
  const order: string[] = [];
  let frontier = newDependents(index, [id], seen);
  while (frontier.length > 0) {
    order.push(...frontier);
    frontier = newDependents(index, frontier, seen);
  }
  return order;
}

function sortedRefs(ids: readonly string[], index: GraphIndex): FileRef[] {
  return [...ids]
    .sort((a, b) => (index.importance.get(b) ?? 0) - (index.importance.get(a) ?? 0) || (a < b ? -1 : 1))
    .slice(0, LIST_LIMIT)
    .map(fileRef);
}

function summarise(activity: NodeActivity | undefined, now: number): ActivitySummary | null {
  if (activity === undefined || activity.reads + activity.edits === 0) return null;
  return {
    edits: activity.edits,
    reads: activity.reads,
    linesChanged: activity.linesChanged,
    lastKind: activity.lastKind,
    ago: formatAgo(now - activity.lastTouchedAt),
  };
}

export function inspectFile(
  index: GraphIndex,
  id: string,
  context: { activity: NodeActivity | undefined; turn: number; now: number },
): InspectorModel | null {
  const role = index.roles.get(id);
  if (role === undefined) return null;
  const importers = index.importers.get(id) ?? [];
  const imports = index.imports.get(id) ?? [];
  const dependents = transitiveDependents(index, id);
  return {
    id,
    name: baseName(id),
    folder: fileFolder(id),
    role,
    changedThisTurn: context.activity?.changedTurn === context.turn,
    activity: summarise(context.activity, context.now),
    importers: sortedRefs(importers, index),
    importerCount: importers.length,
    imports: sortedRefs(imports, index),
    importCount: imports.length,
    affected: dependents.length,
    tests: dependents.filter((dependent) => index.roles.get(dependent) === "tests").length,
  };
}
