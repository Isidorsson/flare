import { describe, expect, test } from "bun:test";

import { buildHeatView, heatLevel, isPulsing, pruneTouches, recordTouch, type Touch, type Touches } from "./heat";

const SECOND = 1000;
const touch = (overrides: Partial<Touch> = {}): Touch => ({ at: 0, edits: 0, reads: 0, lines: 0, lastKind: "read", ...overrides });

describe("heatLevel", () => {
  test("starts at the base for a file that was only touched, and rises with what was done to it", () => {
    expect(heatLevel(touch(), 0)).toBeCloseTo(0.45, 10);
    expect(heatLevel(touch({ reads: 1 }), 0)).toBeCloseTo(0.45 + 0.55 * 0.1, 10);
    expect(heatLevel(touch({ edits: 1 }), 0)).toBeCloseTo(0.45 + 0.55 * 0.3, 10);
    expect(heatLevel(touch({ lines: 30 }), 0)).toBeCloseTo(0.45 + 0.55 * 0.5, 10);
  });

  test("caps the activity at one", () => {
    expect(heatLevel(touch({ edits: 10, lines: 500, reads: 20 }), 0)).toBeCloseTo(1, 10);
  });

  test("decays by 1/e every 240 seconds", () => {
    const hot = touch({ edits: 10 });
    expect(heatLevel(hot, 240 * SECOND)).toBeCloseTo(Math.exp(-1), 10);
    expect(heatLevel(hot, 480 * SECOND)).toBeCloseTo(Math.exp(-2), 10);
  });

  test("treats a touch from the future as brand new", () => {
    expect(heatLevel(touch({ at: 5000 }), 0)).toBeCloseTo(0.45, 10);
  });
});

describe("recordTouch", () => {
  test("counts reads and edits separately and sums the changed lines", () => {
    let touches: Touches = {};
    touches = recordTouch(touches, "a", { kind: "read", lines: 0, at: 10 });
    touches = recordTouch(touches, "a", { kind: "edit", lines: 7, at: 20 });
    touches = recordTouch(touches, "a", { kind: "edit", lines: 3, at: 30 });
    expect(touches.a).toEqual({ at: 30, edits: 2, reads: 1, lines: 10, lastKind: "edit" });
  });

  test("ignores lines for reads and does not touch other files", () => {
    const touches = recordTouch(recordTouch({}, "a", { kind: "edit", lines: 4, at: 1 }), "b", { kind: "read", lines: 99, at: 2 });
    expect(touches.a).toMatchObject({ lines: 4 });
    expect(touches.b).toMatchObject({ lines: 0, reads: 1 });
  });
});

describe("pruneTouches", () => {
  test("forgets files that have cooled below the floor and keeps the rest", () => {
    const touches: Touches = { old: touch({ at: 0 }), fresh: touch({ at: 800 * SECOND }) };
    expect(Object.keys(pruneTouches(touches, 900 * SECOND))).toEqual(["fresh"]);
  });

  test("hands back the same object when nothing was dropped", () => {
    const touches: Touches = { a: touch({ at: 10 * SECOND }) };
    expect(pruneTouches(touches, 20 * SECOND)).toBe(touches);
  });
});

describe("buildHeatView", () => {
  test("drops files below the floor", () => {
    const view = buildHeatView({ cold: touch({ at: 0 }), warm: touch({ at: 700 * SECOND }) }, 800 * SECOND);
    expect([...view.files.keys()]).toEqual(["warm"]);
  });

  test("marks files the agent edited as edits and the others as reads", () => {
    const view = buildHeatView({ a: touch({ edits: 1, lastKind: "edit" }), b: touch({ reads: 2 }), c: touch({ edits: 1, lastKind: "read" }) }, 0);
    expect(view.files.get("a")?.kind).toBe("edit");
    expect(view.files.get("b")?.kind).toBe("read");
    expect(view.files.get("c")?.kind).toBe("edit");
  });

  test("numbers the five most recently touched files", () => {
    const touches: Touches = Object.fromEntries(
      ["a", "b", "c", "d", "e", "f", "g"].map((name, index) => [name, touch({ at: index * SECOND, reads: 1 })]),
    );
    const view = buildHeatView(touches, 10 * SECOND);
    expect(["g", "f", "e", "d", "c"].map((name) => view.files.get(name)?.badge)).toEqual([1, 2, 3, 4, 5]);
    expect(view.files.get("b")?.badge).toBeNull();
    expect(view.files.get("a")?.badge).toBeNull();
  });

  test("numbers only files that are still hot", () => {
    const view = buildHeatView({ old: touch({ at: 0 }), fresh: touch({ at: 790 * SECOND }) }, 800 * SECOND);
    expect(view.files.get("fresh")?.badge).toBe(1);
  });

  test("sparks every folder above a hot file", () => {
    const view = buildHeatView({ "C:/p/src/a/b.ts": touch({ edits: 1 }), "C:/p/lib/c.ts": touch({ at: 1, reads: 1 }) }, 0);
    expect([...view.sparks].sort()).toEqual(["C:/", "C:/p", "C:/p/lib", "C:/p/src", "C:/p/src/a"]);
  });

  test("steps the level from one to ten", () => {
    const view = buildHeatView({ hot: touch({ edits: 10 }), mild: touch({ reads: 0 }) }, 0);
    expect(view.files.get("hot")?.step).toBe(10);
    expect(view.files.get("mild")?.step).toBe(5);
  });

  test("remembers when and how each file was last touched", () => {
    const view = buildHeatView({ a: touch({ at: 4000, edits: 1, lastKind: "read" }) }, 5000);
    expect(view.files.get("a")).toMatchObject({ kind: "edit", lastKind: "read", touchedAt: 4000 });
    expect(view.now).toBe(5000);
  });

  test("is empty when nothing was touched", () => {
    const view = buildHeatView({}, 0);
    expect(view.files.size).toBe(0);
    expect(view.sparks.size).toBe(0);
  });
});

describe("isPulsing", () => {
  const entry = buildHeatView({ a: touch({ at: 10_000, reads: 1 }) }, 10_000).files.get("a");
  if (entry === undefined) throw new Error("expected an entry");

  test("is true for five seconds after the touch", () => {
    expect(isPulsing(entry, 10_000)).toBe(true);
    expect(isPulsing(entry, 14_999)).toBe(true);
    expect(isPulsing(entry, 15_000)).toBe(false);
  });
});
