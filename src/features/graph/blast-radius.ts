import type { GraphIndex } from "./graph-index";

function newImporters(index: GraphIndex, frontier: readonly string[], seen: Set<string>): string[] {
  const found: string[] = [];
  for (const importer of frontier.flatMap((current) => index.importers.get(current) ?? [])) {
    if (seen.has(importer)) continue;
    seen.add(importer);
    found.push(importer);
  }
  return found;
}

/**
 * Every file that reaches `origin` through imports, with the number of import hops it takes, nearest first.
 * The origin itself is not included. This is the one definition of "what a change here can affect".
 */
export function blastDepths(index: GraphIndex, origin: string): ReadonlyMap<string, number> {
  const seen = new Set<string>([origin]);
  const depths = new Map<string, number>();
  let frontier = newImporters(index, [origin], seen);
  for (let depth = 1; frontier.length > 0; depth += 1) {
    for (const id of frontier) depths.set(id, depth);
    frontier = newImporters(index, frontier, seen);
  }
  return depths;
}

/** How many files sit at each distance; the last bucket also holds everything further away. */
export function depthBuckets(depths: ReadonlyMap<string, number>, buckets: number): number[] {
  const counts = Array.from({ length: buckets }, () => 0);
  for (const depth of depths.values()) {
    const bucket = Math.min(depth, buckets) - 1;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}
