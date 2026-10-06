import { describe, expect, test } from "bun:test";

import type { TurnRecord } from "./checkpoint-types";
import { isUndoable, latestRecord, recordForAnchor, restoreBlockedReason, targetOf, undoableTurns } from "./selectors";

function record(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "r1",
    threadId: "t1",
    sessionId: "s1",
    root: "C:/work",
    anchorItemId: "item-0",
    turn: 1,
    status: "ready",
    startedAt: 1,
    files: [{ path: "a.ts", status: "modified", added: 1, removed: 0 }],
    added: 1,
    removed: 0,
    warnings: [],
    error: null,
    ...overrides,
  };
}

describe("isUndoable", () => {
  test("needs a finished turn with a turn number and at least one changed file", () => {
    expect(isUndoable(record())).toBe(true);
    expect(isUndoable(record({ files: [] }))).toBe(false);
    expect(isUndoable(record({ turn: null }))).toBe(false);
    expect(isUndoable(record({ status: "open" }))).toBe(false);
    expect(isUndoable(record({ status: "closing" }))).toBe(false);
    expect(isUndoable(record({ status: "failed" }))).toBe(false);
  });
});

describe("finding records", () => {
  const records = [
    record({ id: "a", threadId: "t1", anchorItemId: "item-0", turn: 1 }),
    record({ id: "b", threadId: "t2", anchorItemId: "item-0", turn: 1 }),
    record({ id: "c", threadId: "t1", anchorItemId: "item-4", turn: 2 }),
    record({ id: "d", threadId: "t1", anchorItemId: "item-8", turn: 3, files: [] }),
  ];

  test("a record is found by its thread and the message that opened the turn", () => {
    expect(recordForAnchor(records, "t1", "item-4")?.id).toBe("c");
    expect(recordForAnchor(records, "t2", "item-0")?.id).toBe("b");
    expect(recordForAnchor(records, "t2", "item-4")).toBeUndefined();
  });

  test("a turn nobody sent a message for shares the anchor, and the newest undoable one is shown", () => {
    const shared = [
      record({ id: "first", anchorItemId: "item-0", turn: 1 }),
      record({ id: "autonomous", anchorItemId: "item-0", turn: 2 }),
      record({ id: "quiet", anchorItemId: "item-0", turn: 3, files: [] }),
    ];
    expect(recordForAnchor(shared, "t1", "item-0")?.id).toBe("autonomous");
    expect(recordForAnchor(shared.slice(2), "t1", "item-0")?.id).toBe("quiet");
  });

  test("the latest record is the newest of that thread", () => {
    expect(latestRecord(records, "t1")?.id).toBe("d");
    expect(latestRecord(records, "nobody")).toBeUndefined();
  });

  test("undoable turns are the thread's changed turns, newest first", () => {
    expect(undoableTurns(records, "t1").map((turn) => turn.id)).toEqual(["c", "a"]);
    expect(undoableTurns(records, "t2").map((turn) => turn.id)).toEqual(["b"]);
  });
});

describe("targetOf", () => {
  test("names the turn to undo or to roll back to", () => {
    const turn = record({ turn: 4 });
    if (!isUndoable(turn)) throw new Error("expected an undoable record");
    expect(targetOf(turn, "undoTurn")).toEqual({
      threadId: "t1",
      sessionId: "s1",
      root: "C:/work",
      request: { kind: "undoTurn", turn: 4 },
    });
    expect(targetOf(turn, "restoreBefore").request).toEqual({ kind: "restoreBefore", turn: 4 });
  });
});

describe("restoreBlockedReason", () => {
  test("is null when nothing is in the way", () => {
    expect(restoreBlockedReason({ agentBusy: false, restoring: false, confirming: false })).toBeNull();
  });

  test("explains each thing that is", () => {
    expect(restoreBlockedReason({ agentBusy: true, restoring: false, confirming: false })).toContain("Claude is still working");
    expect(restoreBlockedReason({ agentBusy: false, restoring: true, confirming: false })).toContain("in progress");
    expect(restoreBlockedReason({ agentBusy: false, restoring: false, confirming: true })).toContain("on screen");
  });

  test("the agent working takes priority", () => {
    expect(restoreBlockedReason({ agentBusy: true, restoring: true, confirming: true })).toContain("Claude is still working");
  });
});
