import { baseName } from "./graph-paths";

export const BLAST_LABEL = "Blast radius";
export const BLAST_HINT = "Select a file to see everything that depends on it.";
export const DEPTH_LABELS = ["Direct", "2 hops", "3+ hops"] as const;

/** What the toolbar toggle's tooltip says it is doing right now. */
export function blastToggleDetail(on: boolean, hasSelection: boolean): string {
  if (!on) return "Colour everything that depends on the selected file by how many imports away it is";
  if (!hasSelection) return "On: select a file to see everything that depends on it";
  return "On: showing everything that depends on the selected file. Press to show its direct imports only";
}

export function blastSummary(origin: string, dependents: number): string {
  const name = baseName(origin);
  if (dependents === 0) return `Nothing imports ${name}`;
  return `${dependents} ${dependents === 1 ? "file depends" : "files depend"} on ${name}`;
}
