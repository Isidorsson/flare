import { z } from "zod";

import {
  COMMIT_SUBJECT_MAX_CHARS,
  FILE_CHANGE_KINDS,
  FILE_EDITING_KINDS,
  MAX_EDITING_TEXT_CHARS,
  MAX_MATCH_LINES,
  PR_TITLE_MAX_CHARS,
} from "./constants";

const nonEmpty = z.string().min(1);
const tokenCount = z.number().int().nonnegative();

export const toolInputSchema = z.record(z.string(), z.unknown());

export const usageSchema = z.object({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadInputTokens: tokenCount,
  cacheCreationInputTokens: tokenCount,
});

export const sessionReadySchema = z.object({
  type: z.literal("session.ready"),
  sessionId: nonEmpty,
});

export const sessionOutputStylesSchema = z.object({
  type: z.literal("session.outputStyles"),
  available: z.array(nonEmpty),
});

export const assistantDeltaSchema = z.object({
  type: z.literal("assistant.delta"),
  text: z.string(),
});

export const assistantMessageSchema = z.object({
  type: z.literal("assistant.message"),
  id: nonEmpty,
  text: z.string(),
});

export const toolStartedSchema = z.object({
  type: z.literal("tool.started"),
  toolUseId: nonEmpty,
  name: nonEmpty,
  input: toolInputSchema,
});

export const toolFinishedSchema = z.object({
  type: z.literal("tool.finished"),
  toolUseId: nonEmpty,
  isError: z.boolean(),
  summary: z.string(),
});

const lineNumber = z.number().int().positive();

export const lineRangeSchema = z
  .object({ start: lineNumber, end: lineNumber })
  .refine((range) => range.end >= range.start, { message: "range.end must not precede range.start" });

export const turnStartedSchema = z.object({
  type: z.literal("turn.started"),
});

export const fileReadSchema = z
  .object({
    type: z.literal("file.read"),
    toolUseId: nonEmpty,
    path: nonEmpty,
    // 1-based lines the Read tool was asked for.
    range: lineRangeSchema.optional(),
    // A search of this single file and the 1-based lines that matched.
    pattern: nonEmpty.optional(),
    matchLines: z.array(lineNumber).max(MAX_MATCH_LINES).optional(),
  })
  .refine((read) => read.matchLines === undefined || read.pattern !== undefined, {
    message: "matchLines requires a pattern",
  })
  .refine((read) => read.range === undefined || read.pattern === undefined, {
    message: "a read has either a range or a pattern",
  });

// The edit the model is still typing, so the UI can show it before the tool runs.
export const fileEditingSchema = z
  .object({
    type: z.literal("file.editing"),
    toolUseId: nonEmpty,
    path: nonEmpty,
    kind: z.enum(FILE_EDITING_KINDS),
    // The text an edit replaces; absent for a whole-file write.
    oldString: z.string().optional(),
    // Everything typed so far into the replacement (or the whole file for a write).
    text: z.string().max(MAX_EDITING_TEXT_CHARS),
  })
  .refine((editing) => editing.kind === "edit" || editing.oldString === undefined, {
    message: "only an edit has an oldString",
  });

export const fileChangeSchema = z.object({
  type: z.literal("file.change"),
  toolUseId: nonEmpty,
  path: nonEmpty,
  kind: z.enum(FILE_CHANGE_KINDS),
  before: z.string().nullable(),
  after: z.string(),
});

export const permissionRequestSchema = z.object({
  type: z.literal("permission.request"),
  requestId: nonEmpty,
  toolName: nonEmpty,
  input: toolInputSchema,
});

export const turnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  // Running total for the whole session, not just this turn.
  costUsd: z.number().nonnegative(),
  usage: usageSchema,
});

export const errorSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  // The session or the bridge process is gone; the app must start a new session.
  fatal: z.boolean().optional(),
});

export const commitGeneratedSchema = z.object({
  type: z.literal("commit.generated"),
  requestId: nonEmpty,
  subject: nonEmpty.max(COMMIT_SUBJECT_MAX_CHARS),
  body: nonEmpty.nullable(),
});

export const commitFailedSchema = z.object({
  type: z.literal("commit.failed"),
  requestId: nonEmpty,
  message: z.string(),
});

export const prGeneratedSchema = z.object({
  type: z.literal("pr.generated"),
  requestId: nonEmpty,
  title: nonEmpty.max(PR_TITLE_MAX_CHARS),
  // Markdown; may be empty when the model wrote nothing beyond the title.
  body: z.string(),
});

export const prFailedSchema = z.object({
  type: z.literal("pr.failed"),
  requestId: nonEmpty,
  message: z.string(),
});

export const bridgeEventSchema = z.discriminatedUnion("type", [
  sessionReadySchema,
  sessionOutputStylesSchema,
  assistantDeltaSchema,
  assistantMessageSchema,
  toolStartedSchema,
  toolFinishedSchema,
  fileReadSchema,
  fileEditingSchema,
  fileChangeSchema,
  permissionRequestSchema,
  turnStartedSchema,
  turnCompletedSchema,
  errorSchema,
  commitGeneratedSchema,
  commitFailedSchema,
  prGeneratedSchema,
  prFailedSchema,
]);

export type ToolInput = z.infer<typeof toolInputSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type FileChangeKind = z.infer<typeof fileChangeSchema>["kind"];
export type FileEditingKind = z.infer<typeof fileEditingSchema>["kind"];
export type LineRange = z.infer<typeof lineRangeSchema>;
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;
export type BridgeEventOf<T extends BridgeEvent["type"]> = Extract<BridgeEvent, { type: T }>;
