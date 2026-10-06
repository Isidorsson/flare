import { describe, expect, test } from "bun:test";

import {
  CheckpointCommandError,
  checkpointListSchema,
  pruneReportSchema,
  restorePlanSchema,
  restoreRequestSchema,
  restoreResultSchema,
  snapshotSchema,
  toCheckpointError,
  turnDiffSchema,
} from "./checkpoint-schemas";

const PLANNED = { path: "src/a.ts", action: "revert", conflict: false };

describe("snapshotSchema", () => {
  test("accepts what checkpoint_create returns", () => {
    const parsed = snapshotSchema.parse({
      sessionId: "s1",
      turn: 3,
      phase: "end",
      commit: "abc123",
      createdAt: 1_700_000_000,
      store: "private",
      warnings: ["could not read a.db"],
    });
    expect(parsed.turn).toBe(3);
    expect(parsed.store).toBe("private");
  });

  test("rejects turn zero, unknown phases and unknown stores", () => {
    const base = { sessionId: "s1", turn: 1, phase: "start", commit: "c", createdAt: 1, store: "git", warnings: [] };
    expect(snapshotSchema.safeParse({ ...base, turn: 0 }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...base, phase: "middle" }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...base, store: "svn" }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...base, warnings: undefined }).success).toBe(false);
  });
});

describe("turnDiffSchema", () => {
  test("accepts line counts and the null counts of binary files", () => {
    const parsed = turnDiffSchema.parse({
      turn: 1,
      files: [
        { path: "a.ts", status: "modified", added: 3, removed: 1 },
        { path: "logo.png", status: "added", added: null, removed: null },
        { path: "old.ts", status: "deleted", added: 0, removed: 9 },
      ],
      added: 3,
      removed: 10,
    });
    expect(parsed.files).toHaveLength(3);
    expect(parsed.files[1]?.added).toBeNull();
  });

  test("rejects negative counts and unknown statuses", () => {
    const file = { path: "a.ts", status: "modified", added: 1, removed: 1 };
    expect(turnDiffSchema.safeParse({ turn: 1, files: [{ ...file, added: -1 }], added: 0, removed: 0 }).success).toBe(false);
    expect(turnDiffSchema.safeParse({ turn: 1, files: [{ ...file, status: "renamed" }], added: 0, removed: 0 }).success).toBe(false);
  });
});

describe("checkpointListSchema", () => {
  test("accepts turns in progress and incomplete restores", () => {
    const parsed = checkpointListSchema.parse({
      store: "git",
      turns: [
        { turn: 1, start: { commit: "a", createdAt: 1 }, end: { commit: "b", createdAt: 2 } },
        { turn: 2, start: { commit: "c", createdAt: 3 }, end: null },
      ],
      restores: [{ id: 1, createdAt: 4, complete: false }],
    });
    expect(parsed.turns[1]?.end).toBeNull();
    expect(parsed.restores[0]?.complete).toBe(false);
  });
});

describe("restore plans and results", () => {
  test("a plan lists files with their action and whether they were edited since", () => {
    const plan = restorePlanSchema.parse({
      files: [PLANNED, { path: "b.ts", action: "delete", conflict: true }, { path: "c.ts", action: "recreate", conflict: false }],
    });
    expect(plan.files.map((file) => file.action)).toEqual(["revert", "delete", "recreate"]);
    expect(restorePlanSchema.safeParse({ files: [{ ...PLANNED, action: "burn" }] }).success).toBe(false);
  });

  test("a result is restored, conflicts or unchanged", () => {
    expect(restoreResultSchema.parse({ status: "restored", restore: 2, files: [PLANNED], warnings: [] }).status).toBe("restored");
    expect(restoreResultSchema.parse({ status: "conflicts", files: [PLANNED] }).status).toBe("conflicts");
    expect(restoreResultSchema.parse({ status: "unchanged" })).toEqual({ status: "unchanged" });
  });

  test("a restored result must say which restore to redo", () => {
    expect(restoreResultSchema.safeParse({ status: "restored", files: [], warnings: [] }).success).toBe(false);
    expect(restoreResultSchema.safeParse({ status: "restored", restore: 0, files: [], warnings: [] }).success).toBe(false);
    expect(restoreResultSchema.safeParse({ status: "exploded" }).success).toBe(false);
  });
});

describe("requests sent to Rust", () => {
  test("have the tagged shapes the Rust enum reads", () => {
    expect(restoreRequestSchema.parse({ kind: "undoTurn", turn: 3 })).toEqual({ kind: "undoTurn", turn: 3 });
    expect(restoreRequestSchema.parse({ kind: "restoreBefore", turn: 1 })).toEqual({ kind: "restoreBefore", turn: 1 });
    expect(restoreRequestSchema.parse({ kind: "redo", restore: 2 })).toEqual({ kind: "redo", restore: 2 });
    expect(restoreRequestSchema.safeParse({ kind: "undoTurn", restore: 2 }).success).toBe(false);
  });

  test("prune reports how many refs it removed", () => {
    expect(pruneReportSchema.parse({ removedRefs: 4 }).removedRefs).toBe(4);
    expect(pruneReportSchema.safeParse({ removedRefs: -1 }).success).toBe(false);
  });
});

describe("toCheckpointError", () => {
  test("keeps the code the Rust side rejected with", () => {
    const error = toCheckpointError({ code: "git_missing", message: "checkpoints need git" });
    expect(error).toBeInstanceOf(CheckpointCommandError);
    expect(error.message).toBe("checkpoints need git");
    expect(error instanceof CheckpointCommandError && error.code).toBe("git_missing");
  });

  test("passes other errors and strings through", () => {
    const original = new Error("boom");
    expect(toCheckpointError(original)).toBe(original);
    expect(toCheckpointError("plain text").message).toBe("plain text");
    expect(toCheckpointError({ unexpected: true }).message).toBe('{"unexpected":true}');
  });
});
