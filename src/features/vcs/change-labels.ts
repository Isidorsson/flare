import type { Change, VcsStatus } from "./vcs-schemas";

export const CHANGE_LABELS: Record<Change, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  typeChanged: "Type changed",
  untracked: "Untracked",
  conflicted: "Merge conflict",
};

export const CHANGE_LETTERS: Record<Change, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typeChanged: "T",
  untracked: "U",
  conflicted: "!",
};

export const CHANGE_TONES: Record<Change, string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-danger",
  renamed: "text-info",
  typeChanged: "text-warning",
  untracked: "text-success",
  conflicted: "text-danger",
};

export function pluralize(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function pluralFiles(count: number): string {
  return pluralize(count, "file");
}

/** Git reports paths with forward slashes on every platform. */
export function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { name: path, dir: "" } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}

export interface SyncSummary {
  /** Short chip text, e.g. "↑2 ↓1". */
  label: string;
  /** The same in full, for the tooltip. */
  detail: string;
}

export function syncSummary(status: Pick<VcsStatus, "upstream" | "ahead" | "behind">): SyncSummary {
  const { upstream, ahead, behind } = status;
  if (upstream === null) return { label: "no upstream", detail: "This branch has no upstream yet; the first push publishes it" };
  if (ahead === 0 && behind === 0) return { label: "synced", detail: `In step with ${upstream}` };
  const label = [...(ahead > 0 ? [`↑${String(ahead)}`] : []), ...(behind > 0 ? [`↓${String(behind)}`] : [])];
  const detail = [
    ...(ahead > 0 ? [`${pluralize(ahead, "commit")} to push`] : []),
    ...(behind > 0 ? [`${pluralize(behind, "commit")} to pull`] : []),
  ];
  return { label: label.join(" "), detail: `${detail.join(", ")} (${upstream})` };
}
