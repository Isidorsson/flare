import { describe, expect, test } from "bun:test";

import { MAX_MATCH_LINES } from "@flare/protocol";

import { planRead, scrollMode } from "./read-plan";

const range = (start: number, end: number) => ({ range: { start, end }, pattern: null, matchLines: null });

describe("planRead for a range", () => {
  test("lights up the requested lines and says which", () => {
    const plan = planRead(range(10, 14), 100);
    expect(plan).toEqual({ lines: [10, 11, 12, 13, 14], first: 10, last: 14, label: "Claude · reading lines 10–14" });
  });

  test("clips a range that runs past the end of the file", () => {
    const plan = planRead(range(90, 2000), 120);
    expect(plan.lines).toHaveLength(31);
    expect(plan).toMatchObject({ first: 90, last: 120, label: "Claude · reading lines 90–120" });
  });

  test("caps the lit lines at 300 but still reports the whole range", () => {
    const plan = planRead(range(1, 2000), 1500);
    expect(plan.lines).toHaveLength(300);
    expect(plan.lines.at(-1)).toBe(300);
    expect(plan).toMatchObject({ first: 1, last: 1500, label: "Claude · reading lines 1–1500" });
  });

  test("handles a range that starts past the end and an empty file", () => {
    expect(planRead(range(500, 600), 100).lines).toEqual([100]);
    expect(planRead(range(1, 50), 0).lines).toEqual([1]);
  });

  test("falls back to the whole file when no range is known", () => {
    const plan = planRead({ range: null, pattern: null, matchLines: null }, 4);
    expect(plan.lines).toEqual([1, 2, 3, 4]);
    expect(plan.label).toBe("Claude · reading lines 1–4");
  });
});

describe("planRead for a search", () => {
  const search = (matchLines: number[]) => ({ range: null, pattern: "useEffect", matchLines });

  test("lights up the matching lines and counts them", () => {
    const plan = planRead(search([40, 3, 18, 18]), 100);
    expect(plan.lines).toEqual([3, 18, 40]);
    expect(plan).toMatchObject({ first: 3, last: 40, label: 'Claude · searching "useEffect" · 4 matches' });
  });

  test("uses the singular for one match", () => {
    expect(planRead(search([7]), 10).label).toBe('Claude · searching "useEffect" · 1 match');
  });

  test("drops lines the file does not have", () => {
    expect(planRead(search([2, 50, 0]), 10).lines).toEqual([2]);
  });

  test("lights nothing for a search without matches", () => {
    const plan = planRead(search([]), 10);
    expect(plan.lines).toEqual([]);
    expect(plan.label).toBe('Claude · searching "useEffect" · 0 matches');
  });

  test("caps the lit lines at the protocol limit", () => {
    const all = Array.from({ length: MAX_MATCH_LINES + 20 }, (_, index) => index + 1);
    expect(planRead(search(all), 1000).lines).toHaveLength(MAX_MATCH_LINES);
  });
});

describe("scrollMode", () => {
  test("centres a span that fits in the view and anchors a taller one at its first line", () => {
    expect(scrollMode(10, 20, 30)).toBe("center");
    expect(scrollMode(10, 39, 30)).toBe("center");
    expect(scrollMode(10, 40, 30)).toBe("top");
  });
});
