import type { RestoreTarget, TurnRecord } from "./checkpoint-types";

/** A turn whose before and after are both recorded and that changed at least one file. */
export type UndoableTurn = TurnRecord & { status: "ready"; turn: number };

export function isUndoable(record: TurnRecord): record is UndoableTurn {
  return record.status === "ready" && record.turn !== null && record.files.length > 0;
}

/**
 * The record of the turn a user message opened. A turn nobody sent a message for shares its
 * predecessor's message, so the newest one that can be undone wins.
 */
export function recordForAnchor(
  records: readonly TurnRecord[],
  threadId: string,
  anchorItemId: string,
): TurnRecord | undefined {
  const matching = records.filter((record) => record.threadId === threadId && record.anchorItemId === anchorItemId);
  return matching.findLast(isUndoable) ?? matching.at(-1);
}

export function latestRecord(records: readonly TurnRecord[], threadId: string): TurnRecord | undefined {
  return records.findLast((record) => record.threadId === threadId);
}

/** The turns of a thread that can be undone, newest first. */
export function undoableTurns(records: readonly TurnRecord[], threadId: string): UndoableTurn[] {
  return records.filter((record) => record.threadId === threadId).filter(isUndoable).reverse();
}

export function targetOf(record: UndoableTurn, kind: "undoTurn" | "restoreBefore"): RestoreTarget {
  return {
    threadId: record.threadId,
    sessionId: record.sessionId,
    root: record.root,
    request: { kind, turn: record.turn },
  };
}

/** Why a restore cannot start now, or null when it can. */
export function restoreBlockedReason(options: { agentBusy: boolean; restoring: boolean; confirming: boolean }): string | null {
  if (options.agentBusy) return "Claude is still working. Stop it or wait for it to finish.";
  if (options.restoring) return "Another restore is in progress.";
  if (options.confirming) return "Finish the question on screen first.";
  return null;
}
