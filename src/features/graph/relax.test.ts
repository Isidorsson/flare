import { describe, expect, test } from "bun:test";

import { folderId } from "./directory-tree";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { buildRelaxModel, relaxPull } from "./relax";

function snapshot(files: readonly string[], edges: readonly (readonly [string, string])[]): GraphSnapshot {
  return {
    root: "C:/app",
    nodes: files.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
}

function modelFor(input: GraphSnapshot, positions: ReadonlyMap<string, { x: number; y: number }>) {
  const graph = snapshotToGraph(input, positions);
  const ids = graph.nodes();
  const xs = Float64Array.from(ids.map((id) => graph.getNodeAttribute(id, "x")));
  const ys = Float64Array.from(ids.map((id) => graph.getNodeAttribute(id, "y")));
  return { model: buildRelaxModel(graph, ids, xs, ys), ids, xs, ys };
}

function at(ids: readonly string[], xs: Float64Array, ys: Float64Array, id: string) {
  const index = ids.indexOf(id);
  return { x: xs[index] ?? NaN, y: ys[index] ?? NaN };
}

const POSITIONS = new Map([
  [folderId(""), { x: 0, y: 0 }],
  [folderId("a"), { x: 0, y: 0 }],
  [folderId("b"), { x: 200, y: 0 }],
  ["a/one.ts", { x: -20, y: 0 }],
  ["a/two.ts", { x: 20, y: 0 }],
  ["a/three.ts", { x: 0, y: 30 }],
  ["b/far.ts", { x: 190, y: 0 }],
]);

describe("relaxPull", () => {
  test("draws files that import each other together", () => {
    const { model, ids, xs, ys } = modelFor(
      snapshot(["a/one.ts", "a/two.ts", "a/three.ts", "b/far.ts"], [["a/one.ts", "a/two.ts"]]),
      POSITIONS,
    );
    const before = Math.abs(at(ids, xs, ys, "a/one.ts").x - at(ids, xs, ys, "a/two.ts").x);
    for (let round = 0; round < 5; round += 1) relaxPull(model, 0.3);
    const after = Math.abs(at(ids, xs, ys, "a/one.ts").x - at(ids, xs, ys, "a/two.ts").x);
    expect(after).toBeLessThan(before);
  });

  test("leaves files without imports where they are", () => {
    const { model, ids, xs, ys } = modelFor(
      snapshot(["a/one.ts", "a/two.ts", "a/three.ts", "b/far.ts"], [["a/one.ts", "a/two.ts"]]),
      POSITIONS,
    );
    relaxPull(model, 0.5);
    expect(at(ids, xs, ys, "a/three.ts")).toEqual({ x: 0, y: 30 });
    expect(at(ids, xs, ys, "b/far.ts")).toEqual({ x: 190, y: 0 });
  });

  test("never lets a file leave the reach of its folder", () => {
    const { model, ids, xs, ys } = modelFor(
      snapshot(["a/one.ts", "a/two.ts", "a/three.ts", "b/far.ts"], [["a/one.ts", "b/far.ts"], ["a/two.ts", "b/far.ts"]]),
      POSITIONS,
    );
    for (let round = 0; round < 40; round += 1) relaxPull(model, 0.5);
    const hub = at(ids, xs, ys, folderId("a"));
    for (const id of ["a/one.ts", "a/two.ts", "a/three.ts"]) {
      const point = at(ids, xs, ys, id);
      expect(Math.hypot(point.x - hub.x, point.y - hub.y)).toBeLessThanOrEqual(35.5);
    }
  });

  test("pulls a file towards the folder it depends on, but only to the edge of its own", () => {
    const { model, ids, xs, ys } = modelFor(
      snapshot(["a/one.ts", "a/two.ts", "a/three.ts", "b/far.ts"], [["a/one.ts", "b/far.ts"]]),
      POSITIONS,
    );
    const before = at(ids, xs, ys, "a/one.ts").x;
    for (let round = 0; round < 40; round += 1) relaxPull(model, 0.5);
    expect(at(ids, xs, ys, "a/one.ts").x).toBeGreaterThan(before);
  });

  test("treats a graph without imports as already relaxed", () => {
    const { model, ids, xs, ys } = modelFor(snapshot(["a/one.ts", "a/two.ts"], []), POSITIONS);
    const before = at(ids, xs, ys, "a/one.ts");
    relaxPull(model, 0.5);
    expect(at(ids, xs, ys, "a/one.ts")).toEqual(before);
  });
});
