import { z } from "zod";

// Mirrors the `vcs_*` commands of src-tauri/src/vcs; the Rust side serialises with camelCase names.

const count = z.number().int().nonnegative();

export const changeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "typeChanged",
  "untracked",
  "conflicted",
]);

export const vcsFileSchema = z.object({
  path: z.string().min(1),
  // The old path of a rename.
  origPath: z.string().min(1).nullable(),
  staged: changeSchema.nullable(),
  unstaged: changeSchema.nullable(),
});

export const vcsStatusSchema = z.object({
  isRepo: z.boolean(),
  // Null while HEAD is detached.
  branch: z.string().min(1).nullable(),
  // Short sha of HEAD; null in a repository without commits.
  head: z.string().min(1).nullable(),
  upstream: z.string().min(1).nullable(),
  ahead: count,
  behind: count,
  files: z.array(vcsFileSchema),
});

// `null` on a side means that side does not exist (an added file has no original).
export const fileDiffSchema = z.object({
  path: z.string().min(1),
  original: z.string().nullable(),
  modified: z.string().nullable(),
  binary: z.boolean(),
});

export const commitResultSchema = z.object({
  commit: z.string().min(1),
  summary: z.string(),
  status: vcsStatusSchema,
});

export const vcsBranchSchema = z.object({
  name: z.string().min(1),
  remote: z.boolean(),
  current: z.boolean(),
  upstream: z.string().min(1).nullable(),
});

export const branchListSchema = z.array(vcsBranchSchema);

export const messageContextSchema = z.object({
  // Staged changes, or everything when nothing is staged.
  source: z.enum(["staged", "all"]),
  stat: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  recentSubjects: z.array(z.string()),
});

export type Change = z.infer<typeof changeSchema>;
export type VcsFile = z.infer<typeof vcsFileSchema>;
export type VcsStatus = z.infer<typeof vcsStatusSchema>;
export type FileDiff = z.infer<typeof fileDiffSchema>;
export type CommitResult = z.infer<typeof commitResultSchema>;
export type VcsBranch = z.infer<typeof vcsBranchSchema>;
export type MessageContext = z.infer<typeof messageContextSchema>;

const errorPayloadSchema = z.object({ code: z.string(), message: z.string() });

export class VcsCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VcsCommandError";
    this.code = code;
  }
}

/** Turns whatever `invoke` rejected with into an Error; the Rust side rejects with `{ code, message }`. */
export function toVcsError(raw: unknown): Error {
  const payload = errorPayloadSchema.safeParse(raw);
  if (payload.success) return new VcsCommandError(payload.data.code, payload.data.message);
  if (raw instanceof Error) return raw;
  return new Error(typeof raw === "string" ? raw : JSON.stringify(raw));
}
