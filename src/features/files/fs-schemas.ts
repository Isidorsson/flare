import { z } from "zod";

export const dirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "dir"]),
});
export type DirEntry = z.infer<typeof dirEntrySchema>;

export const dirListingSchema = z.object({
  entries: z.array(dirEntrySchema),
  truncated: z.boolean(),
});
export type DirListing = z.infer<typeof dirListingSchema>;

export const fileReadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string(), size: z.number() }),
  z.object({ kind: z.literal("binary"), size: z.number() }),
  z.object({ kind: z.literal("tooLarge"), size: z.number(), limit: z.number() }),
]);
export type FileRead = z.infer<typeof fileReadSchema>;

export const watchChangeSchema = z.object({
  path: z.string(),
  kind: z.enum(["create", "modify", "remove"]),
});
export type WatchChange = z.infer<typeof watchChangeSchema>;

export const watchBatchSchema = z.object({
  root: z.string(),
  changes: z.array(watchChangeSchema),
  rescan: z.boolean(),
});
export type WatchBatch = z.infer<typeof watchBatchSchema>;

export const subscriptionIdSchema = z.number().int().nonnegative();

export const fsErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export class FsCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FsCommandError";
    this.code = code;
  }
}

export function toFsError(raw: unknown): Error {
  const payload = fsErrorPayloadSchema.safeParse(raw);
  if (payload.success) return new FsCommandError(payload.data.code, payload.data.message);
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : JSON.stringify(raw));
}

export function isNotFound(error: unknown): boolean {
  return error instanceof FsCommandError && error.code === "not_found";
}
