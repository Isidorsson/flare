import { describe, expect, test } from "bun:test";

import { arcControl, arcPoint, arcTargets, MAX_ARCS_PER_SIDE } from "./arcs";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";

function build(edges: readonly (readonly [string, string])[], files: readonly string[]) {
  const snapshot: GraphSnapshot = {
    root: "C:/app",
    nodes: files.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
  return snapshotToGraph(snapshot, new Map());
}

describe("arcTargets", () => {
  const graph = build(
    [
      ["a.ts", "core.ts"],
      ["b.ts", "core.ts"],
      ["core.ts", "util.ts"],
      ["x.ts", "a.ts"],
      ["y.ts", "a.ts"],
    ],
    ["a.ts", "b.ts", "core.ts", "util.ts", "x.ts", "y.ts"],
  );

  test("separates the files that import a file from the ones it imports", () => {
    const targets = arcTargets(graph, "core.ts");
    expect([...targets.importers].sort()).toEqual(["a.ts", "b.ts"]);
    expect(targets.imports).toEqual(["util.ts"]);
  });

  test("lists the busiest neighbour first", () => {
    expect(arcTargets(graph, "core.ts").importers[0]).toBe("a.ts");
  });

  test("ignores folder links and unknown files", () => {
    expect(arcTargets(graph, "util.ts")).toEqual({ importers: ["core.ts"], imports: [] });
    expect(arcTargets(graph, "missing.ts")).toEqual({ importers: [], imports: [] });
  });

  test("caps the arcs drawn from a hub", () => {
    const files = Array.from({ length: 30 }, (_, index) => `f${index}.ts`);
    const hub = build(files.map((file) => [file, "hub.ts"] as const), [...files, "hub.ts"]);
    expect(arcTargets(hub, "hub.ts").importers).toHaveLength(MAX_ARCS_PER_SIDE);
  });
});

describe("arc geometry", () => {
  test("bows to alternating sides", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    expect(arcControl(from, to, 0).y).toBeGreaterThan(0);
    expect(arcControl(from, to, 1).y).toBeLessThan(0);
    expect(arcControl(from, to, 0).x).toBeCloseTo(50);
  });

  test("starts and ends on the endpoints", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 40 };
    const control = arcControl(from, to, 0);
    expect(arcPoint(from, control, to, 0)).toEqual(from);
    expect(arcPoint(from, control, to, 1)).toEqual(to);
    const middle = arcPoint(from, control, to, 0.5);
    expect(middle.x).toBeCloseTo(0.25 * 0 + 0.5 * control.x + 0.25 * 100);
  });
});
