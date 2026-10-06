import { describe, expect, test } from "bun:test";
import type { RenderParams } from "sigma/types";

import type { AppearanceContext } from "./appearance";
import { edgeStyle, lengthFade, restingEdgeAlpha, screenSpaceParams, type EdgeInfo } from "./edge-appearance";
import { EDGE_TYPE } from "./graph-model";
import { sizeScale } from "./node-scale";
import { fixtureActivityPalette, fixturePalette } from "./palette-fixture";

const palette = fixturePalette();

function context(overrides: Partial<AppearanceContext> = {}): AppearanceContext {
  return {
    palette,
    colorBy: "role",
    level: "files",
    blast: null,
    activityColors: fixtureActivityPalette(),
    activity: { nodes: new Map() },
    now: 0,
    reducedMotion: false,
    focus: null,
    selected: null,
    scale: sizeScale(100, 10),
    sizeFactor: 1,
    layoutSpan: 100,
    edgeAlpha: 0.3,
    ...overrides,
  };
}

function importEdge(source: string, target: string, extra: Partial<EdgeInfo> = {}): EdgeInfo {
  return { kind: "import", source, target, betweenHubs: false, length: 10, mutual: false, drawnAsArc: false, ...extra };
}

function treeEdge(source: string, target: string, betweenHubs: boolean): EdgeInfo {
  return { kind: "tree", source, target, betweenHubs, length: 10, mutual: false, drawnAsArc: false };
}

function depthColor(index: number): string {
  const color = palette.blastDepths[index];
  if (color === undefined) throw new Error(`no blast colour at depth index ${index}`);
  return color;
}

const blast = {
  origin: "src/leaf.ts",
  depths: new Map([
    ["src/mid.ts", 1],
    ["src/top.ts", 2],
    ["src/far.ts", 3],
  ]),
};

describe("restingEdgeAlpha", () => {
  test("fades as the project grows", () => {
    expect(restingEdgeAlpha(20)).toBeGreaterThan(restingEdgeAlpha(300));
    expect(restingEdgeAlpha(300)).toBeGreaterThan(restingEdgeAlpha(1400));
    expect(restingEdgeAlpha(1400)).toBeGreaterThan(restingEdgeAlpha(5000));
  });

  test("stays within sensible bounds at the extremes", () => {
    expect(restingEdgeAlpha(0)).toBeLessThanOrEqual(0.75);
    expect(restingEdgeAlpha(10_000_000)).toBeCloseTo(0.16, 5);
  });
});

describe("lengthFade", () => {
  test("leaves short edges alone and fades long ones towards a floor", () => {
    expect(lengthFade(0, 100)).toBe(1);
    expect(lengthFade(30, 100)).toBeLessThan(1);
    expect(lengthFade(30, 100)).toBeGreaterThan(lengthFade(60, 100));
    expect(lengthFade(500, 100)).toBeCloseTo(0.3);
  });

  test("copes with a layout that has no extent", () => {
    expect(lengthFade(5, 0)).toBe(1);
  });
});

describe("import edges", () => {
  test("fade as they get longer", () => {
    const short = edgeStyle({ ...importEdge("src/a.ts", "src/b.ts"), length: 5 }, context());
    const long = edgeStyle({ ...importEdge("src/a.ts", "src/b.ts"), length: 80 }, context());
    expect(short.color).not.toBe(long.color);
  });

  test("are faint, thin plain lines at rest", () => {
    const style = edgeStyle(importEdge("src/a.ts", "src/b.ts"), context());
    expect(style.size).toBeLessThanOrEqual(1);
    expect(style.color.startsWith("rgba(")).toBe(true);
    expect(style.type).toBe(EDGE_TYPE);
  });

  test("draw a pair of files that import each other as one line", () => {
    const forward = edgeStyle(importEdge("a.lua", "b.lua", { mutual: true }), context());
    const backward = edgeStyle(importEdge("b.lua", "a.lua", { mutual: true }), context());
    expect([forward.hidden, backward.hidden].filter((hidden) => !hidden)).toHaveLength(1);
  });

  test("keep the stronger direction's style for a mutual pair, so a blast path is never lost", () => {
    const ctx = context({ blast });
    const kept = edgeStyle(importEdge("src/leaf.ts", "src/mid.ts", { mutual: true }), ctx);
    expect(kept.hidden).toBe(false);
    expect(kept.color).toBe(depthColor(0));
  });

  test("give a mutual pair touching the active file its own colour", () => {
    const ctx = context({ focus: { node: "a.lua", neighbours: new Set(["b.lua", "c.lua"]) } });
    const mutual = edgeStyle(importEdge("a.lua", "b.lua", { mutual: true }), ctx).color;
    const outgoing = edgeStyle(importEdge("a.lua", "c.lua"), ctx).color;
    const incoming = edgeStyle(importEdge("c.lua", "a.lua"), ctx).color;
    expect(new Set([mutual, outgoing, incoming]).size).toBe(3);
  });

  test("leave the pairs the selection draws as arcs to the overlay", () => {
    const ctx = context({ selected: "src/a.ts" });
    expect(edgeStyle(importEdge("src/a.ts", "src/b.ts", { drawnAsArc: true }), ctx).hidden).toBe(true);
    expect(edgeStyle(importEdge("src/a.ts", "src/b.ts"), ctx).hidden).toBe(false);
  });

  test("are hidden in the overview until a file is selected or hovered", () => {
    const edge = importEdge("src/a.ts", "src/b.ts");
    expect(edgeStyle(edge, context({ level: "overview" })).hidden).toBe(true);
    expect(edgeStyle(edge, context({ level: "overview", selected: "src/a.ts" })).hidden).toBe(false);
    const hovered = { node: "src/b.ts", neighbours: new Set(["src/a.ts"]) };
    expect(edgeStyle(edge, context({ level: "overview", focus: hovered })).hidden).toBe(false);
  });

  test("colour the selected file's imports and importers differently", () => {
    const outgoing = edgeStyle(importEdge("src/a.ts", "src/b.ts"), context({ selected: "src/a.ts" }));
    const incoming = edgeStyle(importEdge("src/c.ts", "src/a.ts"), context({ selected: "src/a.ts" }));
    expect(outgoing.color).not.toBe(incoming.color);
    expect(outgoing.size).toBeGreaterThan(edgeStyle(importEdge("src/x.ts", "src/y.ts"), context({ selected: "src/a.ts" })).size);
  });

  test("fade away from a hovered node while keeping its own edges strong", () => {
    const focus = { node: "src/a.ts", neighbours: new Set(["src/b.ts"]) };
    const touching = edgeStyle(importEdge("src/a.ts", "src/b.ts"), context({ focus }));
    const elsewhere = edgeStyle(importEdge("src/x.ts", "src/y.ts"), context({ focus }));
    expect(touching.size).toBeGreaterThan(elsewhere.size);
    expect(elsewhere.color).not.toBe(edgeStyle(importEdge("src/x.ts", "src/y.ts"), context()).color);
  });

  test("only edges that lead a dependent one step closer to the origin are highlighted in a blast", () => {
    const ctx = context({ blast });
    const direct = edgeStyle(importEdge("src/mid.ts", "src/leaf.ts"), ctx);
    const next = edgeStyle(importEdge("src/top.ts", "src/mid.ts"), ctx);
    const sideways = edgeStyle(importEdge("src/top.ts", "src/far.ts"), ctx);
    const unrelated = edgeStyle(importEdge("src/x.ts", "src/y.ts"), ctx);
    expect(direct.color).toBe(depthColor(0));
    expect(next.color).toBe(depthColor(1));
    expect(sideways.color).not.toBe(depthColor(1));
    expect(unrelated.size).toBeLessThan(direct.size);
    expect(direct.zIndex).toBeGreaterThan(unrelated.zIndex);
  });
});

describe("folder links", () => {
  const overview = context({ level: "overview" });

  test("show only between two hubs, and only in the overview", () => {
    expect(edgeStyle(treeEdge("a", "b", true), overview).hidden).toBe(false);
    expect(edgeStyle(treeEdge("a", "b", false), overview).hidden).toBe(true);
    expect(edgeStyle(treeEdge("a", "b", true), context({ level: "files" })).hidden).toBe(true);
  });

  test("sit under every import and are no wider than one", () => {
    const link = edgeStyle(treeEdge("a", "b", true), overview);
    const imported = edgeStyle(importEdge("x", "y"), context({ level: "overview", selected: "x" }));
    expect(link.zIndex).toBeLessThan(imported.zIndex);
    expect(link.size).toBeLessThanOrEqual(edgeStyle(importEdge("x", "y"), context()).size);
  });

  test("brighten around a hovered hub", () => {
    const hovered = edgeStyle(treeEdge("a", "b", true), context({ level: "overview", focus: { node: "a", neighbours: new Set() } }));
    expect(hovered.zIndex).toBeGreaterThan(edgeStyle(treeEdge("a", "b", true), overview).zIndex);
    expect(hovered.color).not.toBe(edgeStyle(treeEdge("a", "b", true), overview).color);
  });
});

describe("screenSpaceParams", () => {
  function params(zoomRatio: number): RenderParams {
    return {
      matrix: new Float32Array(9),
      invMatrix: new Float32Array(9),
      width: 800,
      height: 600,
      pixelRatio: 2,
      zoomRatio,
      cameraAngle: 0,
      sizeRatio: Math.sqrt(zoomRatio),
      correctionRatio: 0.004,
      downSizingRatio: 1,
      minEdgeThickness: 1,
      antiAliasingFeather: 1,
    };
  }

  test("keeps edge widths in screen pixels at any zoom, leaving every other parameter alone", () => {
    for (const zoom of [0.03, 1, 30]) {
      const original = params(zoom);
      expect(screenSpaceParams(original)).toEqual({ ...original, sizeRatio: 1 });
    }
  });
});
