import { describe, expect, test } from "bun:test";

import type { AppearanceContext } from "./appearance";
import { edgeStyle, lengthFade, restingEdgeAlpha, showsArrows, type EdgeInfo } from "./edge-appearance";
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
    arrows: true,
    ...overrides,
  };
}

function importEdge(source: string, target: string): EdgeInfo {
  return { kind: "import", source, target, betweenHubs: false, length: 10 };
}

function treeEdge(source: string, target: string, betweenHubs: boolean): EdgeInfo {
  return { kind: "tree", source, target, betweenHubs, length: 10 };
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

  test("keeps arrowheads for small graphs only", () => {
    expect(showsArrows(120)).toBe(true);
    expect(showsArrows(2000)).toBe(false);
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

  test("are faint and thin at rest, and drawn as arrows or plain lines by density", () => {
    const style = edgeStyle(importEdge("src/a.ts", "src/b.ts"), context());
    expect(style.size).toBeLessThanOrEqual(1);
    expect(style.color.startsWith("rgba(")).toBe(true);
    expect(style.type).toBe("arrow");
    expect(edgeStyle(importEdge("src/a.ts", "src/b.ts"), context({ arrows: false })).type).toBe("line");
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
  test("show only between two hubs", () => {
    expect(edgeStyle(treeEdge("a", "b", true), context()).hidden).toBe(false);
    expect(edgeStyle(treeEdge("a", "b", false), context()).hidden).toBe(true);
  });

  test("are fainter at the files level than in the overview, and brighten around a hovered hub", () => {
    const overview = edgeStyle(treeEdge("a", "b", true), context({ level: "overview" }));
    const files = edgeStyle(treeEdge("a", "b", true), context({ level: "files" }));
    expect(overview.color).not.toBe(files.color);
    const hovered = edgeStyle(treeEdge("a", "b", true), context({ level: "overview", focus: { node: "a", neighbours: new Set() } }));
    expect(hovered.zIndex).toBeGreaterThan(overview.zIndex);
  });
});
