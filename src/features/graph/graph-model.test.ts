import { describe, expect, test } from "bun:test";

import { folderId } from "./directory-tree";
import { diffSnapshots } from "./graph-diff";
import { createCodeGraph, displayNode, IMPORT_EDGE_TYPE, readPositions, TREE_EDGE_TYPE, type NodeAttrs } from "./graph-model";
import { snapshotToGraph, syncGraph } from "./graph-sync";
import type { GraphSnapshot, Language } from "./graph-types";

function snapshot(
  nodes: readonly (readonly [string, Language])[],
  edges: readonly (readonly [string, string])[] = [],
): GraphSnapshot {
  return {
    root: "C:/work/shop",
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

function edgeList(graph: ReturnType<typeof createCodeGraph>): string[] {
  return graph.edges().map((edge) => `${graph.source(edge)}>${graph.target(edge)}`).sort();
}

describe("snapshotToGraph", () => {
  const graph = snapshotToGraph(base, new Map());

  test("creates a file node per file and a folder node per directory", () => {
    expect(graph.hasNode("src/a.ts")).toBe(true);
    expect(graph.hasNode(folderId("src"))).toBe(true);
    expect(graph.hasNode(folderId("core"))).toBe(true);
    expect(graph.hasNode(folderId(""))).toBe(true);
    expect(graph.order).toBe(3 + 3);
  });

  test("describes files and folders for the view", () => {
    const file = graph.getNodeAttributes("src/a.ts");
    expect(file).toMatchObject({ kind: "file", label: "a.ts", language: "typescript", folder: "src", hub: "src" });
    const folder = graph.getNodeAttributes(folderId("src"));
    expect(folder).toMatchObject({ kind: "folder", label: "src", language: null, files: 2, hub: "src" });
    expect(graph.getNodeAttribute(folderId(""), "label")).toBe("shop");
  });

  test("keeps import edges apart from folder links, and never self-loops", () => {
    expect(graph.hasDirectedEdge("src/a.ts", "src/b.ts")).toBe(true);
    expect(graph.hasDirectedEdge("src/b.ts", "src/a.ts")).toBe(false);
    const edge = graph.edge("src/a.ts", "src/b.ts");
    expect(edge === undefined ? undefined : graph.getEdgeAttributes(edge)).toMatchObject({
      kind: "import",
      type: IMPORT_EDGE_TYPE,
    });
    const link = graph.edge(folderId("src"), "src/a.ts");
    expect(link === undefined ? undefined : graph.getEdgeAttributes(link)).toMatchObject({ kind: "tree", type: TREE_EDGE_TYPE });
    expect(graph.hasDirectedEdge(folderId(""), folderId("src"))).toBe(true);
    expect(graph.hasDirectedEdge("core/lib.rs", "core/lib.rs")).toBe(false);
  });

  test("sizes files by how much the rest of the code leans on them", () => {
    const hub = snapshot(
      [["lib/core.ts", "typescript"], ["a.ts", "typescript"], ["b.ts", "typescript"], ["c.ts", "typescript"]],
      [["a.ts", "lib/core.ts"], ["b.ts", "lib/core.ts"], ["c.ts", "lib/core.ts"]],
    );
    const sized = snapshotToGraph(hub, new Map());
    expect(sized.getNodeAttribute("lib/core.ts", "size")).toBeGreaterThan(sized.getNodeAttribute("a.ts", "size"));
  });

  test("gives every node finite coordinates and is deterministic", () => {
    graph.forEachNode((_, attributes) => {
      expect(Number.isFinite(attributes.x)).toBe(true);
      expect(Number.isFinite(attributes.y)).toBe(true);
    });
    expect(readPositions(snapshotToGraph(base, new Map()))).toEqual(readPositions(graph));
  });

  test("restores stored positions exactly, including folders", () => {
    const restored = snapshotToGraph(
      base,
      new Map([
        ["src/a.ts", { x: 5, y: -7 }],
        [folderId("src"), { x: 1, y: 2 }],
      ]),
    );
    expect(restored.getNodeAttributes("src/a.ts")).toMatchObject({ x: 5, y: -7 });
    expect(restored.getNodeAttributes(folderId("src"))).toMatchObject({ x: 1, y: 2 });
  });

  test("starts the files of a folder around its hub", () => {
    const hub = graph.getNodeAttributes(folderId("src"));
    const other = graph.getNodeAttributes(folderId("core"));
    const file = graph.getNodeAttributes("src/a.ts");
    expect(Math.hypot(file.x - hub.x, file.y - hub.y)).toBeLessThan(Math.hypot(file.x - other.x, file.y - other.y));
  });

  test("rejects a file id that collides with the folder namespace", () => {
    expect(() => snapshotToGraph(snapshot([[folderId("x"), "typescript"]]), new Map())).toThrow("collides");
  });
});

describe("syncGraph", () => {
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
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    const expected = snapshotToGraph(next, new Map());
    expect(graph.nodes().sort()).toEqual(expected.nodes().sort());
    expect(edgeList(graph)).toEqual(edgeList(expected));
  });

  test("keeps existing nodes where they are", () => {
    const graph = snapshotToGraph(base, new Map([["src/a.ts", { x: 42, y: 24 }]]));
    const next = snapshot([...base.nodes.map((node) => [node.id, node.language] as const), ["src/z.ts", "typescript"]]);
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    expect(graph.getNodeAttributes("src/a.ts")).toMatchObject({ x: 42, y: 24 });
  });

  test("places a new file next to the files it imports", () => {
    const graph = snapshotToGraph(base, new Map([["src/a.ts", { x: 500, y: 500 }]]));
    const next: GraphSnapshot = {
      ...base,
      nodes: [...base.nodes, { id: "core/new.ts", language: "typescript" }],
      edges: [...base.edges, { source: "core/new.ts", target: "src/a.ts" }],
    };
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    const placed = graph.getNodeAttributes("core/new.ts");
    expect(Math.hypot(placed.x - 500, placed.y - 500)).toBeLessThan(20);
  });

  test("places an unconnected new file next to its folder hub", () => {
    const graph = snapshotToGraph(base, new Map([[folderId("src"), { x: -300, y: 80 }]]));
    const next = snapshot([...base.nodes.map((node) => [node.id, node.language] as const), ["src/lonely.ts", "typescript"]]);
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    const placed = graph.getNodeAttributes("src/lonely.ts");
    expect(Math.hypot(placed.x + 300, placed.y - 80)).toBeLessThan(20);
  });

  test("drops removed files, their edges and the folders left empty", () => {
    const graph = snapshotToGraph(base, new Map());
    const next = snapshot([["src/a.ts", "typescript"]]);
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    expect(graph.hasNode("src/b.ts")).toBe(false);
    expect(graph.hasNode(folderId("core"))).toBe(false);
    expect(graph.hasNode(folderId("src"))).toBe(true);
    expect([...graph.edges()].some((edge) => graph.getEdgeAttribute(edge, "kind") === "import")).toBe(false);
  });

  test("removes a lone import without touching its endpoints", () => {
    const graph = snapshotToGraph(base, new Map());
    const next = { ...base, edges: [] };
    syncGraph(graph, next, diffSnapshots(base, next), new Map());
    expect(graph.hasNode("src/a.ts")).toBe(true);
    expect(graph.hasDirectedEdge("src/a.ts", "src/b.ts")).toBe(false);
    expect(graph.hasDirectedEdge(folderId("src"), "src/a.ts")).toBe(true);
  });

  test("tolerates duplicate additions and edges to unknown files", () => {
    const graph = createCodeGraph();
    const next = snapshot([["a.ts", "typescript"]], [["a.ts", "ghost.ts"]]);
    const diff = diffSnapshots(null, next);
    syncGraph(graph, next, diff, new Map());
    syncGraph(graph, next, diff, new Map());
    expect(graph.order).toBe(2);
    expect([...graph.edges()].filter((edge) => graph.getEdgeAttribute(edge, "kind") === "import")).toHaveLength(0);
  });
});

describe("displayNode", () => {
  test("keeps the layout position under the reducer's style", () => {
    const data: NodeAttrs = {
      x: 12,
      y: -3,
      size: 4,
      label: "a.ts",
      kind: "file",
      language: "typescript",
      role: "code",
      hub: "src",
      folder: "src",
      files: 0,
      importance: 0,
    };
    const style = { color: "#fff", size: 9, label: "a.ts", zIndex: 1, hidden: false };
    expect(displayNode(data, style)).toMatchObject({ x: 12, y: -3, size: 9, color: "#fff" });
  });
});
