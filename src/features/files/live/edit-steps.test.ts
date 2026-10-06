import { describe, expect, test } from "bun:test";

import { changedLines, editLabel, groupSteps, pauseAfterStepMs, planEdit } from "./edit-steps";
import { diffLines } from "./line-diff";
import { LIVE } from "./timing";

function numbered(count: number, change: Record<number, string> = {}): string {
  return Array.from({ length: count }, (_, index) => `${change[index + 1] ?? `line ${String(index + 1)}`}\n`).join("");
}

describe("groupSteps", () => {
  const base = numbered(60);

  test("merges hunks that sit closer together than the gap", () => {
    const steps = groupSteps(diffLines(base, numbered(60, { 10: "x", 15: "y" })));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ firstLine: 10, lastLine: 15, added: 2, removed: 2 });
  });

  test("keeps hunks apart once six unchanged lines separate them", () => {
    const apart = groupSteps(diffLines(base, numbered(60, { 10: "x", 17: "y" })));
    expect(apart.map((step) => [step.firstLine, step.lastLine])).toEqual([
      [10, 10],
      [17, 17],
    ]);
    expect(groupSteps(diffLines(base, numbered(60, { 10: "x", 16: "y" })))).toHaveLength(1);
  });

  test("chains several close hunks into one step and starts another after a long stretch", () => {
    const steps = groupSteps(diffLines(base, numbered(60, { 5: "a", 9: "b", 13: "c", 40: "d" })));
    expect(steps.map((step) => [step.firstLine, step.lastLine, step.added])).toEqual([
      [5, 13, 3],
      [40, 40, 1],
    ]);
  });

  test("measures a removal by the line that now follows it", () => {
    const steps = groupSteps(diffLines(numbered(30), numbered(30).replace("line 10\n", "").replace("line 12\n", "")));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ removed: 2, added: 0, firstLine: 10, lastLine: 11 });
  });

  test("honours a custom gap and gives nothing for no hunks", () => {
    expect(groupSteps(diffLines(base, numbered(60, { 10: "x", 20: "y" })), 20)).toHaveLength(1);
    expect(groupSteps([])).toEqual([]);
  });
});

describe("planEdit", () => {
  const spread = (changes: number) =>
    numbered(
      200,
      Object.fromEntries(Array.from({ length: changes }, (_, index) => [index * 15 + 3, `changed ${String(index)}`])),
    );

  test("plays every step up to the limit", () => {
    const plan = planEdit(numbered(200), spread(12), { busy: false });
    expect(plan.steps).toHaveLength(LIVE.edit.maxSteps);
    expect(plan.totalSteps).toBe(12);
    expect(plan.created).toBe(false);
  });

  test("plays a single step when other actions are waiting", () => {
    const plan = planEdit(numbered(200), spread(4), { busy: true });
    expect(plan.steps).toHaveLength(1);
    expect(plan.totalSteps).toBe(4);
  });

  test("plays a new file as one step over all its lines", () => {
    const plan = planEdit(null, numbered(40), { busy: false });
    expect(plan.created).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ firstLine: 1, lastLine: 40, added: 40, removed: 0 });
  });

  test("has no steps for a change that leaves the text as it was", () => {
    expect(planEdit("same\n", "same\n", { busy: false }).steps).toEqual([]);
  });
});

describe("pacing and labels", () => {
  const [step] = groupSteps(diffLines(numbered(30), numbered(30, { 5: "x", 6: "y" })));
  if (step === undefined) throw new Error("expected a step");

  test("pauses longer for bigger steps, up to a ceiling", () => {
    expect(changedLines(step)).toBe(4);
    expect(pauseAfterStepMs(step, false)).toBe(700 + 4 * 30);
    const huge = { ...step, added: 500, removed: 500 };
    expect(pauseAfterStepMs(huge, false)).toBe(2400);
  });

  test("pauses briefly when the edit was already typed out", () => {
    expect(pauseAfterStepMs(step, true)).toBe(LIVE.edit.settleStepPauseMs);
  });

  test("labels the lines and the position of a step", () => {
    expect(editLabel({ step, stepIndex: 1, stepCount: 3, created: false })).toBe("Claude · editing lines 5–6 · change 2 of 3");
    expect(editLabel({ step: { ...step, lastLine: step.firstLine }, stepIndex: 0, stepCount: 1, created: false })).toBe(
      "Claude · editing line 5 · change 1 of 1",
    );
  });

  test("labels a new file without line numbers", () => {
    expect(editLabel({ step, stepIndex: 0, stepCount: 1, created: true })).toBe("Claude · writing a new file");
  });
});
