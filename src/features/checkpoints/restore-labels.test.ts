import { describe, expect, test } from "bun:test";

import type { PlannedFile } from "./checkpoint-schemas";
import type { RestoreTarget } from "./checkpoint-types";
import {
  conflictCount,
  errorNotice,
  infoNotice,
  pluralFiles,
  restoreConfirmLabel,
  restoredNotice,
  restoreSummary,
  restoreTitle,
} from "./restore-labels";

const TARGET: RestoreTarget = {
  threadId: "t1",
  sessionId: "s1",
  root: "C:/work",
  request: { kind: "undoTurn", turn: 2 },
};

const FILES: PlannedFile[] = [
  { path: "a.ts", action: "revert", conflict: true },
  { path: "b.ts", action: "delete", conflict: false },
];

describe("wording", () => {
  test("counts files with the right plural", () => {
    expect(pluralFiles(0)).toBe("0 files");
    expect(pluralFiles(1)).toBe("1 file");
    expect(pluralFiles(2)).toBe("2 files");
  });

  test("counts the files edited since", () => {
    expect(conflictCount(FILES)).toBe(1);
    expect(conflictCount([])).toBe(0);
  });

  test("each kind of restore has a title and an explanation", () => {
    expect(restoreTitle({ kind: "undoTurn", turn: 1 })).toBe("Undo this turn?");
    expect(restoreTitle({ kind: "restoreBefore", turn: 1 })).toBe("Roll back to before this turn?");
    expect(restoreTitle({ kind: "redo", restore: 1 })).toBe("Redo?");
    expect(restoreSummary({ kind: "restoreBefore", turn: 1 })).toContain("later turns");
    expect(restoreSummary({ kind: "undoTurn", turn: 1 })).toContain("Every other file stays");
  });

  test("the confirm button names what overwriting costs when files were edited", () => {
    expect(restoreConfirmLabel({ kind: "undoTurn", turn: 1 }, 0)).toBe("Undo turn");
    expect(restoreConfirmLabel({ kind: "restoreBefore", turn: 1 }, 0)).toBe("Roll back");
    expect(restoreConfirmLabel({ kind: "redo", restore: 1 }, 0)).toBe("Redo");
    expect(restoreConfirmLabel({ kind: "undoTurn", turn: 1 }, 1)).toBe("Overwrite 1 file and continue");
    expect(restoreConfirmLabel({ kind: "undoTurn", turn: 1 }, 3)).toBe("Overwrite 3 files and continue");
  });
});

describe("restoredNotice", () => {
  test("after an undo it offers a redo of that restore", () => {
    const notice = restoredNotice(TARGET, { status: "restored", restore: 7, files: FILES, warnings: [] });
    expect(notice.message).toBe("Turn undone: 2 files put back");
    expect(notice.detail).toBeNull();
    expect(notice.action?.label).toBe("Redo");
    expect(notice.action?.target).toEqual({ ...TARGET, request: { kind: "redo", restore: 7 } });
  });

  test("after a redo it offers to undo again", () => {
    const redo: RestoreTarget = { ...TARGET, request: { kind: "redo", restore: 7 } };
    const notice = restoredNotice(redo, { status: "restored", restore: 8, files: FILES, warnings: [] });
    expect(notice.message).toBe("Redone: 2 files changed");
    expect(notice.action?.label).toBe("Undo again");
    expect(notice.action?.target.request).toEqual({ kind: "redo", restore: 8 });
  });

  test("after a roll back the wording says so", () => {
    const rollback: RestoreTarget = { ...TARGET, request: { kind: "restoreBefore", turn: 2 } };
    const notice = restoredNotice(rollback, { status: "restored", restore: 1, files: FILES, warnings: [] });
    expect(notice.message).toBe("Rolled back: 2 files put back");
  });

  test("warnings become the detail line", () => {
    const notice = restoredNotice(TARGET, { status: "restored", restore: 1, files: FILES, warnings: ["one", "two"] });
    expect(notice.detail).toBe("one\ntwo");
  });
});

describe("plain notices", () => {
  test("info and error notices have no action", () => {
    expect(infoNotice("hi")).toEqual({ tone: "info", message: "hi", detail: null, action: null });
    expect(errorNotice("bad")).toEqual({ tone: "error", message: "bad", detail: null, action: null });
  });
});
