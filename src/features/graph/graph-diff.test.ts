import { describe, expect, test } from "bun:test";

import { diffSnapshots, edgeKey, isEmptyDiff } from "./graph-diff";
import type { GraphSnapshot, Language } from "./graph-types";

function snapshot(
  nodes: readonly (readonly [string, Language])[],
  edges: readonly (readonly [string, string])[] = [],
): GraphSnapshot {
  return {
    root: "C:/app",
    nodes: nodes.map(([id, language]) => ({ id, language })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
}

const base = snapshot(
  [
    ["src/a.ts", "typescript"],
    ["src/b.ts", "typescript"],
    ["core/lib.rs", "rust"],
  ],
  [
    ["src/a.ts", "src/b.ts"],
    ["core/lib.rs", "core/lib.rs"],
  ],
);

describe("diffSnapshots", () => {
  test("treats the first snapshot as all additions", () => {
    const diff = diffSnapshots(null, base);
    expect(diff.addedNodes).toHaveLength(3);
    expect(diff.addedEdges).toHaveLength(2);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.removedEdges).toEqual([]);
  });

  test("is empty for identical snapshots", () => {
    expect(isEmptyDiff(diffSnapshots(base, structuredClone(base)))).toBe(true);
  });

  test("reports added and removed nodes and edges separately", () => {
    const next = snapshot(
      [
        ["src/a.ts", "typescript"],
        ["src/new.py", "python"],
      ],
      [["src/a.ts", "src/new.py"]],
    );
    const diff = diffSnapshots(base, next);
    expect(diff.addedNodes.map((node) => node.id)).toEqual(["src/new.py"]);
    expect([...diff.removedNodes].sort()).toEqual(["core/lib.rs", "src/b.ts"]);
    expect(diff.addedEdges).toEqual([{ source: "src/a.ts", target: "src/new.py" }]);
    expect(diff.removedEdges.map(edgeKey)).toContain(edgeKey({ source: "src/a.ts", target: "src/b.ts" }));
  });

  test("distinguishes edge direction", () => {
    const reversed = snapshot(
      [
        ["x.ts", "typescript"],
        ["y.ts", "typescript"],
      ],
      [["y.ts", "x.ts"]],
    );
    const original = snapshot(reversed.nodes.map((node) => [node.id, node.language] as const), [["x.ts", "y.ts"]]);
    const diff = diffSnapshots(original, reversed);
    expect(diff.addedEdges).toHaveLength(1);
    expect(diff.removedEdges).toHaveLength(1);
  });
});
