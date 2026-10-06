import { z } from "zod";

import { FILE_CHANGE_KINDS } from "./constants";

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

export const fileReadSchema = z.object({
  type: z.literal("file.read"),
  toolUseId: nonEmpty,
  path: nonEmpty,
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

export const bridgeEventSchema = z.discriminatedUnion("type", [
  sessionReadySchema,
  assistantDeltaSchema,
  assistantMessageSchema,
  toolStartedSchema,
  toolFinishedSchema,
  fileReadSchema,
  fileChangeSchema,
  permissionRequestSchema,
  turnCompletedSchema,
  errorSchema,
]);

export type ToolInput = z.infer<typeof toolInputSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type FileChangeKind = z.infer<typeof fileChangeSchema>["kind"];
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;
export type BridgeEventOf<T extends BridgeEvent["type"]> = Extract<BridgeEvent, { type: T }>;
