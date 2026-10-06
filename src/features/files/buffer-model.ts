import type { FileRead } from "./fs-schemas";
import type { OpenFile } from "./files-types";

export function loadingFile(path: string, preview: boolean): OpenFile {
  return { path, status: "loading", saved: "", draft: "", preview, saving: false, conflict: null, error: null };
}

export function fromRead(file: OpenFile, read: FileRead): OpenFile {
  const reset = { ...file, conflict: null, error: null, saving: false };
  if (read.kind === "text") return { ...reset, status: "ready", saved: read.content, draft: read.content };
  return { ...reset, status: read.kind, saved: "", draft: "" };
}

/**
 * Folds the current on-disk content (`null` once the file is gone) into an
 * open buffer. A clean buffer follows the disk; a dirty one keeps the user's
 * draft and records what changed underneath it.
 */
export function reconcileDisk(file: OpenFile, disk: string | null): OpenFile {
  if (file.status !== "ready" || file.saving) return file;
  if (disk === null) return { ...file, conflict: { kind: "deleted" } };
  if (file.draft === file.saved) return { ...file, saved: disk, draft: disk, conflict: null };
  if (disk === file.draft) return { ...file, saved: disk, conflict: null };
  if (disk === file.saved) return { ...file, conflict: null };
  return { ...file, conflict: { kind: "modified", content: disk } };
}

export function afterSave(file: OpenFile, written: string): OpenFile {
  return { ...file, saved: written, saving: false, conflict: null, error: null, preview: false };
}
