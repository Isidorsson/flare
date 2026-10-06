import { describe, expect, test } from "bun:test";

import { diffSnapshots, edgeKey, isEmptyDiff } from "./graph-diff";
import {
  applyDiff,
  createCodeGraph,
  EDGE_TYPE,
  readPositions,
  snapshotToGraph,
} from "./graph-model";
import type { GraphSnapshot, Language } from "./graph-types";
import { FILE_SPREAD_RADIUS, initialPosition, positionNear } from "./placement";

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

describe("snapshotToGraph", () => {
  const graph = snapshotToGraph(base, new Map());

  test("creates a directed node per file with display attributes", () => {
    expect(graph.order).toBe(3);
    expect(graph.getNodeAttribute("src/a.ts", "label")).toBe("a.ts");
    expect(graph.getNodeAttribute("src/a.ts", "dirKey")).toBe("src");
    expect(graph.getNodeAttribute("core/lib.rs", "language")).toBe("rust");
  });

  test("creates directed arrow edges and never self-loops", () => {
    expect(graph.hasDirectedEdge("src/a.ts", "src/b.ts")).toBe(true);
    expect(graph.hasDirectedEdge("src/b.ts", "src/a.ts")).toBe(false);
    expect(graph.size).toBe(1);
    const edge = graph.edge("src/a.ts", "src/b.ts");
    expect(edge === undefined ? undefined : graph.getEdgeAttribute(edge, "type")).toBe(EDGE_TYPE);
  });

  test("gives every node finite coordinates", () => {
    graph.forEachNode((_, attributes) => {
      expect(Number.isFinite(attributes.x)).toBe(true);
      expect(Number.isFinite(attributes.y)).toBe(true);
    });
  });

  test("is deterministic for the same snapshot", () => {
    expect(readPositions(snapshotToGraph(base, new Map()))).toEqual(readPositions(graph));
  });

  test("restores stored positions exactly and places the rest itself", () => {
    const restored = snapshotToGraph(base, new Map([["src/a.ts", { x: 5, y: -7 }]]));
    expect(restored.getNodeAttributes("src/a.ts").x).toBe(5);
    expect(restored.getNodeAttributes("src/a.ts").y).toBe(-7);
    expect(restored.getNodeAttributes("src/b.ts").x).toBe(initialPosition("src/b.ts").x);
  });

  test("starts files of one folder next to each other", () => {
    const a = initialPosition("src/features/chat/a.ts");
    const b = initialPosition("src/features/chat/b.ts");
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(FILE_SPREAD_RADIUS * 2);
  });
});

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

describe("applyDiff", () => {
  test("applying the diff to the old graph yields the new graph", () => {
    const next = snapshot(
      [
        ["src/a.ts", "typescript"],
        ["src/b.ts", "typescript"],
        ["src/c.ts", "typescript"],
      ],
      [
        ["src/a.ts", "src/c.ts"],
        ["src/c.ts", "src/b.ts"],
      ],
    );
    const graph = snapshotToGraph(base, new Map());
    applyDiff(graph, diffSnapshots(base, next), new Map());
    const expected = snapshotToGraph(next, new Map());
    expect(graph.nodes().sort()).toEqual(expected.nodes().sort());
    expect(graph.edges().map((edge) => `${graph.source(edge)}>${graph.target(edge)}`).sort()).toEqual(
      expected.edges().map((edge) => `${expected.source(edge)}>${expected.target(edge)}`).sort(),
    );
  });

  test("keeps existing nodes where they are", () => {
    const graph = snapshotToGraph(base, new Map([["src/a.ts", { x: 42, y: 24 }]]));
    const next = snapshot([...base.nodes.map((node) => [node.id, node.language] as const), ["src/z.ts", "typescript"]]);
    applyDiff(graph, diffSnapshots(base, next), new Map());
    expect(graph.getNodeAttributes("src/a.ts").x).toBe(42);
    expect(graph.getNodeAttributes("src/a.ts").y).toBe(24);
  });

  test("places a new file next to the files it is connected to", () => {
    const graph = snapshotToGraph(base, new Map([["src/a.ts", { x: 500, y: 500 }]]));
    const next: GraphSnapshot = {
      ...base,
      nodes: [...base.nodes, { id: "src/new.ts", language: "typescript" }],
      edges: [...base.edges, { source: "src/new.ts", target: "src/a.ts" }],
    };
    applyDiff(graph, diffSnapshots(base, next), new Map());
    const placed = graph.getNodeAttributes("src/new.ts");
    expect(Math.hypot(placed.x - 500, placed.y - 500)).toBeLessThan(10);
  });

  test("drops edges together with their removed nodes", () => {
    const graph = snapshotToGraph(base, new Map());
    const next = snapshot([["src/a.ts", "typescript"]]);
    applyDiff(graph, diffSnapshots(base, next), new Map());
    expect(graph.nodes()).toEqual(["src/a.ts"]);
    expect(graph.size).toBe(0);
  });

  test("removes a lone edge without touching its endpoints", () => {
    const graph = snapshotToGraph(base, new Map());
    const next = { ...base, edges: [] };
    applyDiff(graph, diffSnapshots(base, next), new Map());
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(0);
  });

  test("tolerates duplicate additions and edges to unknown files", () => {
    const graph = createCodeGraph();
    const diff = {
      addedNodes: [{ id: "a.ts", language: "typescript" as const }],
      removedNodes: ["missing.ts"],
      addedEdges: [
        { source: "a.ts", target: "ghost.ts" },
        { source: "a.ts", target: "a.ts" },
      ],
      removedEdges: [{ source: "x", target: "y" }],
    };
    applyDiff(graph, diff, new Map());
    applyDiff(graph, { ...diff, addedNodes: diff.addedNodes }, new Map());
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
  });

  test("positionNear falls back to the folder position without neighbours", () => {
    expect(positionNear("src/a.ts", [])).toEqual(initialPosition("src/a.ts"));
  });
});
