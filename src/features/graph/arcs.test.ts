import { describe, expect, test } from "bun:test";

import { arcColor, arcControl, arcLinks, arcOrigin, arcPairs, arcPoint, arcShape, isArcPair, MAX_ARCS_PER_SIDE } from "./arcs";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { fixturePalette } from "./palette-fixture";

function build(edges: readonly (readonly [string, string])[], files: readonly string[]) {
  const snapshot: GraphSnapshot = {
    root: "C:/app",
    nodes: files.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
  return snapshotToGraph(snapshot, new Map());
}

describe("arcLinks", () => {
  const graph = build(
    [
      ["a.ts", "core.ts"],
      ["b.ts", "core.ts"],
      ["core.ts", "util.ts"],
      ["core.ts", "peer.ts"],
      ["peer.ts", "core.ts"],
      ["x.ts", "a.ts"],
      ["y.ts", "a.ts"],
    ],
    ["a.ts", "b.ts", "core.ts", "util.ts", "peer.ts", "x.ts", "y.ts"],
  );

  test("gives each neighbouring file exactly one link, marking imports that run both ways as mutual", () => {
    const links = arcLinks(graph, "core.ts");
    expect(links.map((link) => link.id).sort()).toEqual(["a.ts", "b.ts", "peer.ts", "util.ts"]);
    expect(links.find((link) => link.id === "peer.ts")?.relation).toBe("mutual");
    expect(links.find((link) => link.id === "util.ts")?.relation).toBe("import");
    expect(links.find((link) => link.id === "b.ts")?.relation).toBe("importer");
  });

  test("lists the busiest neighbour first", () => {
    expect(arcLinks(graph, "core.ts")[0]?.id).toBe("a.ts");
  });

  test("ignores folder links, unknown files and no selection", () => {
    expect(arcLinks(graph, "util.ts")).toEqual([{ id: "core.ts", relation: "importer" }]);
    expect(arcLinks(graph, "missing.ts")).toEqual([]);
    expect(arcLinks(graph, null)).toEqual([]);
  });

  test("caps the arcs drawn from a hub on each side", () => {
    const files = Array.from({ length: 30 }, (_, index) => `f${index}.ts`);
    const hub = build(
      [...files.map((file) => [file, "hub.ts"] as const), ["hub.ts", "dep.ts"]],
      [...files, "hub.ts", "dep.ts"],
    );
    const links = arcLinks(hub, "hub.ts");
    expect(links.filter((link) => link.relation === "importer")).toHaveLength(MAX_ARCS_PER_SIDE);
    expect(links.filter((link) => link.relation === "import")).toEqual([{ id: "dep.ts", relation: "import" }]);
  });

  test("marks the pairs it draws, in both directions, so the edge renderer leaves them out", () => {
    const pairs = arcPairs(graph, "core.ts");
    expect(isArcPair(pairs, "core.ts", "util.ts")).toBe(true);
    expect(isArcPair(pairs, "b.ts", "core.ts")).toBe(true);
    expect(isArcPair(pairs, "peer.ts", "core.ts")).toBe(true);
    expect(isArcPair(pairs, "core.ts", "peer.ts")).toBe(true);
    expect(isArcPair(pairs, "x.ts", "a.ts")).toBe(false);
    expect(isArcPair(arcPairs(graph, null), "core.ts", "util.ts")).toBe(false);
  });

  test("leave hubs beyond the cap to sigma's straight edges", () => {
    const files = Array.from({ length: 10 }, (_, index) => `f${index}.ts`);
    const hub = build(files.map((file) => [file, "hub.ts"] as const), [...files, "hub.ts"]);
    const pairs = arcPairs(hub, "hub.ts");
    expect(files.filter((file) => isArcPair(pairs, file, "hub.ts"))).toHaveLength(MAX_ARCS_PER_SIDE);
  });

  test("only fan out from the selection in the direct reach", () => {
    expect(arcOrigin({ reach: "direct", selected: "a.ts" })).toBe("a.ts");
    expect(arcOrigin({ reach: "blast", selected: "a.ts" })).toBeNull();
  });
});

describe("arc geometry", () => {
  const origin = { x: 0, y: 0 };

  test("arcs to neighbouring files bow to the same side instead of mirroring", () => {
    const first = arcControl(origin, { x: -100, y: 0 });
    const second = arcControl(origin, { x: -100, y: 5 });
    expect(Math.sign(first.y)).toBe(Math.sign(second.y));
    expect(first.x).toBeCloseTo(-50);
  });

  test("an importer's arc and an import's arc to the same file are the same curve, only run the other way", () => {
    const neighbour = { x: 100, y: 40 };
    const incoming = arcShape("importer", origin, neighbour);
    const outgoing = arcShape("import", origin, neighbour);
    expect(incoming.control).toEqual(outgoing.control);
    expect(incoming.from).toEqual(neighbour);
    expect(incoming.to).toEqual(origin);
    expect(outgoing.from).toEqual(origin);
    expect(arcPoint(incoming.from, incoming.control, incoming.to, 0.5)).toEqual(
      arcPoint(outgoing.from, outgoing.control, outgoing.to, 0.5),
    );
  });

  test("starts and ends on the endpoints", () => {
    const to = { x: 100, y: 40 };
    const control = arcControl(origin, to);
    expect(arcPoint(origin, control, to, 0)).toEqual(origin);
    expect(arcPoint(origin, control, to, 1)).toEqual(to);
  });
});

describe("arcColor", () => {
  test("tells importers, imports and mutual imports apart", () => {
    const palette = fixturePalette();
    const colors = new Set([arcColor(palette, "importer"), arcColor(palette, "import"), arcColor(palette, "mutual")]);
    expect(colors.size).toBe(3);
    expect(arcColor(palette, "importer")).toBe(palette.importer);
  });
});
