import type { FileDelta, PlannedFile, RestoreRequest } from "./checkpoint-schemas";

/** Where a turn runs: the chat thread it belongs to and the snapshots' home. */
export interface TurnContext {
  threadId: string;
  /** What snapshots are scoped by. Flare uses the thread's id: it exists from the first message. */
  sessionId: string;
  root: string;
  /** The chat item (the user's message) that opened the turn, so the transcript can find its record. */
  anchorItemId: string;
}

/**
 * open: the agent is working. closing: the end snapshot is being taken.
 * ready: before and after are recorded and `files` is known. failed: a snapshot could not be taken.
 */
export type TurnStatus = "open" | "closing" | "ready" | "failed";

export interface TurnRecord extends TurnContext {
  id: string;
  /** The checkpoint turn number, known once the start snapshot exists. */
  turn: number | null;
  status: TurnStatus;
  startedAt: number;
  files: FileDelta[];
  added: number;
  removed: number;
  /** Files git could not read; they are not covered by an undo. */
  warnings: string[];
  error: string | null;
}

/** One restore, described fully enough to plan it, confirm it and run it. */
export interface RestoreTarget {
  threadId: string;
  sessionId: string;
  root: string;
  request: RestoreRequest;
}

/** planning: reading what would change. ready: waiting for the user. restoring: files are being written. */
export type PendingStatus = "planning" | "ready" | "restoring";

export interface PendingRestore {
  target: RestoreTarget;
  status: PendingStatus;
  files: PlannedFile[];
}

export interface NoticeAction {
  label: string;
  /** What pressing it does, for its tooltip. */
  hint: string;
  target: RestoreTarget;
}

export interface CheckpointNotice {
  tone: "info" | "error";
  message: string;
  detail: string | null;
  action: NoticeAction | null;
}
