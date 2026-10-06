import { describe, expect, test } from "bun:test";

import {
  BLAST_LABEL_LIMIT,
  fileLabelBudget,
  NEIGHBOUR_LABEL_LIMIT,
  planLabels,
  TOUCHED_LABEL_LIMIT,
  type LabelPlanInput,
} from "./label-select";

const VIEW = { width: 700, height: 600 };

function input(overrides: Partial<LabelPlanInput> = {}): LabelPlanInput {
  return {
    level: "files",
    ranked: ["a.ts", "b.ts", "c.ts", "d.ts"],
    hubs: ["hub:src", "hub:lib"],
    focus: null,
    selected: null,
    blast: null,
    touched: new Map(),
    budget: 2,
    workedHubs: new Set(),
    ...overrides,
  };
}

describe("fileLabelBudget", () => {
  test("labels every file of a small project", () => {
    expect(fileLabelBudget(25, VIEW, 1)).toBe(25);
  });

  test("labels only a handful of files in a big project at fit zoom", () => {
    const budget = fileLabelBudget(2000, VIEW, 1);
    expect(budget).toBeGreaterThanOrEqual(6);
    expect(budget).toBeLessThan(90);
  });

  test("allows more labels as the camera zooms in, up to a cap", () => {
    expect(fileLabelBudget(2000, VIEW, 0.2)).toBeGreaterThan(fileLabelBudget(2000, VIEW, 1));
    expect(fileLabelBudget(2000, { width: 4000, height: 4000 }, 0.03)).toBeLessThanOrEqual(90);
  });

  test("gives a tiny view a sensible minimum", () => {
    expect(fileLabelBudget(500, { width: 100, height: 100 }, 1)).toBeGreaterThanOrEqual(6);
  });
});

describe("planLabels", () => {
  test("labels hubs and the most important files within the budget", () => {
    const ids = planLabels(input()).map((label) => label.id);
    for (const expected of ["hub:src", "hub:lib", "a.ts", "b.ts"]) expect(ids).toContain(expected);
    expect(ids).not.toContain("c.ts");
  });

  test("labels no ordinary files in the overview", () => {
    const ids = planLabels(input({ level: "overview" })).map((label) => label.id);
    expect(ids).toEqual(["hub:src", "hub:lib"]);
  });

  test("puts the hovered node first, then the selection, then touched files", () => {
    const plan = planLabels(
      input({
        focus: { node: "c.ts", neighbours: new Set(["d.ts"]) },
        selected: "a.ts",
        touched: new Map([["b.ts", 5]]),
      }),
    );
    expect(plan.slice(0, 4).map((label) => [label.id, label.tone])).toEqual([
      ["c.ts", "focus"],
      ["a.ts", "selected"],
      ["b.ts", "hot"],
      ["d.ts", "neighbour"],
    ]);
  });

  test("labels the most recently touched files, capped", () => {
    const touched = new Map(Array.from({ length: 30 }, (_, index) => [`f${index}.ts`, index] as const));
    const hot = planLabels(input({ touched })).filter((label) => label.tone === "hot");
    expect(hot).toHaveLength(TOUCHED_LABEL_LIMIT);
    expect(hot[0]?.id).toBe("f29.ts");
  });

  test("caps the neighbours it labels", () => {
    const neighbours = new Set(Array.from({ length: 40 }, (_, index) => `n${index}.ts`));
    const plan = planLabels(input({ focus: { node: "a.ts", neighbours } }));
    expect(plan.filter((label) => label.tone === "neighbour")).toHaveLength(NEIGHBOUR_LABEL_LIMIT);
  });

  test("labels the origin and direct dependents of a blast", () => {
    const depths = new Map<string, number>(Array.from({ length: 30 }, (_, index) => [`d${index}.ts`, 1] as const));
    depths.set("far.ts", 3);
    const plan = planLabels(input({ blast: { origin: "o.ts", depths } }));
    expect(plan[0]).toMatchObject({ id: "o.ts", tone: "blast" });
    expect(plan.filter((label) => label.tone === "blast")).toHaveLength(BLAST_LABEL_LIMIT + 1);
    expect(plan.some((label) => label.id === "far.ts")).toBe(false);
  });

  test("labels hubs the agent worked in ahead of quiet ones", () => {
    const ids = planLabels(input({ level: "overview", workedHubs: new Set(["hub:lib"]) })).map((label) => label.id);
    expect(ids).toEqual(["hub:lib", "hub:src"]);
  });

  test("lists a node once, under its strongest reason", () => {
    const plan = planLabels(input({ focus: { node: "a.ts", neighbours: new Set() }, touched: new Map([["a.ts", 1]]) }));
    expect(plan.filter((label) => label.id === "a.ts")).toEqual([{ id: "a.ts", tone: "focus", priority: 1000 }]);
  });
});
