import { describe, expect, test } from "bun:test";

import type { TimelineEntry } from "../files-types";
import { summarizeTurn, turnMarks, turnReplay } from "./turn-summary";

let sequence = 0;
function entry(overrides: Partial<TimelineEntry> & Pick<TimelineEntry, "path">): TimelineEntry {
  sequence += 1;
  return {
    id: `change-${String(sequence)}`,
    turnId: "t1",
    toolUseId: `tool-${String(sequence)}`,
    kind: "update",
    before: "a\nb\nc\n",
    after: "a\nB\nc\nd\n",
    ...overrides,
  };
}

describe("summarizeTurn", () => {
  test("totals the added and removed lines of the files changed in the turn", () => {
    const summary = summarizeTurn(
      [entry({ path: "a.ts" }), entry({ path: "b.ts", kind: "create", before: null, after: "x\ny\nz\n" })],
      "t1",
    );
    expect(summary.files).toEqual([
      { path: "a.ts", kind: "edit", added: 2, removed: 1 },
      { path: "b.ts", kind: "create", added: 3, removed: 0 },
    ]);
    expect(summary).toMatchObject({ added: 5, removed: 1 });
  });

  test("ignores the changes of other turns", () => {
    const summary = summarizeTurn([entry({ path: "a.ts", turnId: "t0" }), entry({ path: "b.ts" })], "t1");
    expect(summary.files.map((file) => file.path)).toEqual(["b.ts"]);
  });

  test("adds up several edits to one file into the net change", () => {
    const summary = summarizeTurn(
      [
        entry({ path: "a.ts", before: "one\ntwo\n", after: "one\ntwo\nthree\n" }),
        entry({ path: "a.ts", before: "one\ntwo\nthree\n", after: "one\n2\nthree\nfour\n" }),
      ],
      "t1",
    );
    expect(summary.files).toEqual([{ path: "a.ts", kind: "edit", added: 3, removed: 1 }]);
  });

  test("keeps a file created in the turn as new however often it was edited after", () => {
    const summary = summarizeTurn(
      [
        entry({ path: "n.ts", kind: "create", before: null, after: "a\n" }),
        entry({ path: "n.ts", before: "a\n", after: "a\nb\n" }),
      ],
      "t1",
    );
    expect(summary.files).toEqual([{ path: "n.ts", kind: "create", added: 2, removed: 0 }]);
  });

  test("lists nothing before any turn has started", () => {
    expect(summarizeTurn([entry({ path: "a.ts" })], null)).toEqual({ files: [], added: 0, removed: 0 });
  });

  test("lists files in the order they were first changed", () => {
    const summary = summarizeTurn([entry({ path: "b.ts" }), entry({ path: "a.ts" }), entry({ path: "b.ts" })], "t1");
    expect(summary.files.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("turnMarks", () => {
  test("marks the added lines and where lines were removed", () => {
    const marks = turnMarks(
      [entry({ path: "a.ts", before: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n", after: "a\nB\nc\nd\ne\nf\ng\nh\nj\n" })],
      "t1",
      "a.ts",
    );
    expect(marks).toEqual({ added: [{ start: 2, end: 2 }], removedAt: [2, 9] });
  });

  test("is null for a file the turn did not touch or before any turn", () => {
    expect(turnMarks([entry({ path: "a.ts" })], "t1", "b.ts")).toBeNull();
    expect(turnMarks([entry({ path: "a.ts" })], null, "a.ts")).toBeNull();
    expect(turnMarks([entry({ path: "a.ts", turnId: "t0" })], "t1", "a.ts")).toBeNull();
  });

  test("marks a whole new file as added", () => {
    const marks = turnMarks([entry({ path: "n.ts", kind: "create", before: null, after: "a\nb\nc\n" })], "t1", "n.ts");
    expect(marks).toEqual({ added: [{ start: 1, end: 3 }], removedAt: [] });
  });
});

describe("turnReplay", () => {
  test("spans from the first before to the last after", () => {
    const changes = [
      entry({ path: "a.ts", before: "v1", after: "v2" }),
      entry({ path: "a.ts", before: "v2", after: "v3" }),
    ];
    expect(turnReplay(changes, "t1", "a.ts")).toEqual({ before: "v1", after: "v3" });
    expect(turnReplay(changes, "t2", "a.ts")).toBeNull();
  });
});
