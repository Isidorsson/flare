import { z } from "zod";

// Mirrors src-tauri/src/checkpoints/model.rs; the Rust side serialises with camelCase names.

const count = z.number().int().nonnegative();
const turnNumber = z.number().int().positive();

export const phaseSchema = z.enum(["start", "end"]);
export const storeKindSchema = z.enum(["git", "private"]);

export const snapshotSchema = z.object({
  sessionId: z.string().min(1),
  turn: turnNumber,
  phase: phaseSchema,
  commit: z.string().min(1),
  createdAt: z.number().int(),
  store: storeKindSchema,
  warnings: z.array(z.string()),
});

export const fileDeltaSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted"]),
  // Absent for binary files.
  added: count.nullable(),
  removed: count.nullable(),
});

export const turnDiffSchema = z.object({
  turn: turnNumber,
  files: z.array(fileDeltaSchema),
  added: count,
  removed: count,
});

const snapshotRefSchema = z.object({ commit: z.string().min(1), createdAt: z.number().int() });

export const checkpointListSchema = z.object({
  store: storeKindSchema,
  turns: z.array(
    z.object({ turn: turnNumber, start: snapshotRefSchema.nullable(), end: snapshotRefSchema.nullable() }),
  ),
  restores: z.array(z.object({ id: turnNumber, createdAt: z.number().int(), complete: z.boolean() })),
});

export const plannedFileSchema = z.object({
  path: z.string().min(1),
  // revert: older content goes back; delete: the file did not exist then; recreate: it was deleted since.
  action: z.enum(["revert", "delete", "recreate"]),
  // The file changed after the point being restored from, so restoring discards that change.
  conflict: z.boolean(),
});

export const restorePlanSchema = z.object({ files: z.array(plannedFileSchema) });

export const restoreResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("restored"),
    restore: turnNumber,
    files: z.array(plannedFileSchema),
    warnings: z.array(z.string()),
  }),
  z.object({ status: z.literal("conflicts"), files: z.array(plannedFileSchema) }),
  z.object({ status: z.literal("unchanged") }),
]);

export const pruneReportSchema = z.object({ removedRefs: count });

export const restoreRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("undoTurn"), turn: turnNumber }),
  z.object({ kind: z.literal("restoreBefore"), turn: turnNumber }),
  z.object({ kind: z.literal("redo"), restore: turnNumber }),
]);

export type Snapshot = z.infer<typeof snapshotSchema>;
export type FileDelta = z.infer<typeof fileDeltaSchema>;
export type TurnDiff = z.infer<typeof turnDiffSchema>;
export type CheckpointList = z.infer<typeof checkpointListSchema>;
export type PlannedFile = z.infer<typeof plannedFileSchema>;
export type FileAction = PlannedFile["action"];
export type RestorePlan = z.infer<typeof restorePlanSchema>;
export type RestoreResult = z.infer<typeof restoreResultSchema>;
export type PruneReport = z.infer<typeof pruneReportSchema>;
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

const errorPayloadSchema = z.object({ code: z.string(), message: z.string() });

export class CheckpointCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CheckpointCommandError";
    this.code = code;
  }
}

/** Turns whatever `invoke` rejected with into an Error; the Rust side rejects with `{ code, message }`. */
export function toCheckpointError(raw: unknown): Error {
  const payload = errorPayloadSchema.safeParse(raw);
  if (payload.success) return new CheckpointCommandError(payload.data.code, payload.data.message);
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : JSON.stringify(raw));
}
