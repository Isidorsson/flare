import { describe, expect, test } from "bun:test";

import { blastDepths, depthBuckets } from "./blast-radius";
import { buildGraphIndex } from "./graph-index";
import type { GraphSnapshot } from "./graph-types";

function indexOf(ids: readonly string[], edges: readonly [string, string][]) {
  const snapshot: GraphSnapshot = {
    root: "C:/app",
    nodes: ids.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
  return buildGraphIndex(snapshot);
}

describe("blastDepths", () => {
  test("walks importers breadth first and reports how many hops away each one is", () => {
    const index = indexOf(["a", "b", "c", "d", "e"], [["a", "b"], ["b", "c"], ["d", "c"], ["e", "d"]]);
    expect([...blastDepths(index, "c")]).toEqual([
      ["b", 1],
      ["d", 1],
      ["a", 2],
      ["e", 2],
    ]);
  });

  test("uses the shortest path where imports form a diamond", () => {
    const index = indexOf(
      ["top", "left", "right", "base"],
      [["top", "left"], ["top", "right"], ["left", "base"], ["right", "base"], ["top", "base"]],
    );
    expect([...blastDepths(index, "base")].sort()).toEqual([["left", 1], ["right", 1], ["top", 1]]);
  });

  test("terminates on cycles and never lists the origin", () => {
    const index = indexOf(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]);
    expect([...blastDepths(index, "a")]).toEqual([
      ["c", 1],
      ["b", 2],
    ]);
  });

  test("is empty for a file nobody imports or that is not in the graph", () => {
    const index = indexOf(["a", "b"], [["a", "b"]]);
    expect(blastDepths(index, "a").size).toBe(0);
    expect(blastDepths(index, "missing").size).toBe(0);
  });

  test("follows long chains to their full depth", () => {
    const ids = Array.from({ length: 200 }, (_, position) => `n${position}`);
    const edges = ids.slice(1).map((id, position): [string, string] => [ids[position] ?? "", id]);
    const depths = blastDepths(indexOf(ids, edges), "n199");
    expect(depths.size).toBe(199);
    expect(depths.get("n0")).toBe(199);
  });
});

describe("depthBuckets", () => {
  test("counts files per distance and folds the far ones into the last bucket", () => {
    const depths = new Map([["a", 1], ["b", 1], ["c", 2], ["d", 3], ["e", 7]]);
    expect(depthBuckets(depths, 3)).toEqual([2, 1, 2]);
  });

  test("is all zeros when nothing depends on the file", () => {
    expect(depthBuckets(new Map(), 3)).toEqual([0, 0, 0]);
  });
});
