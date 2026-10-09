import { z } from "zod";

import { EFFORT_LEVELS, MAX_COMMIT_RECENT_SUBJECTS, PERMISSION_DECISIONS, PERMISSION_MODES } from "./constants";

export const effortSchema = z.enum(EFFORT_LEVELS);
export const permissionModeSchema = z.enum(PERMISSION_MODES);
export const permissionDecisionSchema = z.enum(PERMISSION_DECISIONS);
export const outputStyleSchema = z.string().min(1);

const nonEmpty = z.string().min(1);

export const sessionStartSchema = z.object({
  type: z.literal("session.start"),
  cwd: nonEmpty,
  model: nonEmpty,
  effort: effortSchema,
  permissionMode: permissionModeSchema,
  outputStyle: outputStyleSchema,
  resume: nonEmpty.optional(),
});

export const userMessageSchema = z.object({
  type: z.literal("user.message"),
  text: nonEmpty,
});

export const permissionRespondSchema = z.object({
  type: z.literal("permission.respond"),
  requestId: nonEmpty,
  decision: permissionDecisionSchema,
});

export const interruptSchema = z.object({
  type: z.literal("interrupt"),
});

export const sessionSetModelSchema = z.object({
  type: z.literal("session.setModel"),
  model: nonEmpty,
});

export const sessionSetEffortSchema = z.object({
  type: z.literal("session.setEffort"),
  effort: effortSchema,
});

export const sessionSetPermissionModeSchema = z.object({
  type: z.literal("session.setPermissionMode"),
  permissionMode: permissionModeSchema,
});

// Independent of the chat session: it works whether or not a session has been started.
export const commitGenerateSchema = z.object({
  type: z.literal("commit.generate"),
  requestId: nonEmpty,
  // `git diff --stat` and the patch of the changes to describe.
  stat: z.string(),
  patch: z.string(),
  // The patch was cut short before it was sent.
  truncated: z.boolean(),
  // Most recent first, as a hint for the message style.
  recentSubjects: z.array(z.string()).max(MAX_COMMIT_RECENT_SUBJECTS),
  includeBody: z.boolean(),
});

export const appMessageSchema = z.discriminatedUnion("type", [
  sessionStartSchema,
  userMessageSchema,
  permissionRespondSchema,
  interruptSchema,
  sessionSetModelSchema,
  sessionSetEffortSchema,
  sessionSetPermissionModeSchema,
  commitGenerateSchema,
]);

export type Effort = z.infer<typeof effortSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type AppMessage = z.infer<typeof appMessageSchema>;
export type AppMessageOf<T extends AppMessage["type"]> = Extract<AppMessage, { type: T }>;
