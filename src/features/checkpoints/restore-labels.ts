import type { PlannedFile, RestoreRequest, RestoreResult } from "./checkpoint-schemas";
import type { CheckpointNotice, RestoreTarget } from "./checkpoint-types";

type Restored = Extract<RestoreResult, { status: "restored" }>;

export function pluralFiles(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
}

export function conflictCount(files: readonly PlannedFile[]): number {
  return files.filter((file) => file.conflict).length;
}

export function restoreTitle(request: RestoreRequest): string {
  switch (request.kind) {
    case "undoTurn":
      return "Undo this turn?";
    case "restoreBefore":
      return "Roll back to before this turn?";
    case "redo":
      return "Redo?";
  }
}

export function restoreSummary(request: RestoreRequest): string {
  switch (request.kind) {
    case "undoTurn":
      return "Only the files this turn changed are put back. Every other file stays as it is.";
    case "restoreBefore":
      return "The workspace goes back to how it was before this turn, so everything Claude did in later turns is undone too.";
    case "redo":
      return "The files return to the state they were in before the undo.";
  }
}

export function restoreConfirmLabel(request: RestoreRequest, conflicts: number): string {
  if (conflicts > 0) return `Overwrite ${pluralFiles(conflicts)} and continue`;
  switch (request.kind) {
    case "undoTurn":
      return "Undo turn";
    case "restoreBefore":
      return "Roll back";
    case "redo":
      return "Redo";
  }
}

function doneMessage(request: RestoreRequest, files: number): string {
  const count = pluralFiles(files);
  switch (request.kind) {
    case "undoTurn":
      return `Turn undone: ${count} put back`;
    case "restoreBefore":
      return `Rolled back: ${count} put back`;
    case "redo":
      return `Redone: ${count} changed`;
  }
}

/** The notice after a restore: it offers to take the restore back, using the safety checkpoint it made. */
export function restoredNotice(target: RestoreTarget, result: Restored): CheckpointNotice {
  const redo: RestoreTarget = { ...target, request: { kind: "redo", restore: result.restore } };
  const undoing = target.request.kind !== "redo";
  return {
    tone: "info",
    message: doneMessage(target.request, result.files.length),
    detail: result.warnings.length === 0 ? null : result.warnings.join("\n"),
    action: {
      label: undoing ? "Redo" : "Undo again",
      hint: undoing ? "Put the files back the way they were before this undo" : "Take this redo back again",
      target: redo,
    },
  };
}

export function infoNotice(message: string): CheckpointNotice {
  return { tone: "info", message, detail: null, action: null };
}

export function errorNotice(message: string): CheckpointNotice {
  return { tone: "error", message, detail: null, action: null };
}
