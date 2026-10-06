import { describe, expect, test } from "bun:test";

import {
  edgeStyle,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  nodeSize,
  nodeStyle,
  type AppearanceContext,
  type NodeInfo,
} from "./appearance";
import { mixColors, parseHex } from "./color-math";
import { nodeBrightness, TWINKLE_MS } from "./activity-math";
import { activityColor } from "./activity-palette";
import type { NodeActivity } from "./activity-state";
import { fixtureActivityPalette, fixturePalette } from "./palette-fixture";

const palette = fixturePalette();
const activityColors = fixtureActivityPalette();

function depthColor(index: number): string {
  const color = palette.blastDepths[index];
  if (color === undefined) throw new Error(`no blast colour at depth index ${index}`);
  return color;
}

function distance(a: string, b: string): number {
  const left = parseHex(a);
  const right = parseHex(b);
  return Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b);
}

function context(overrides: Partial<AppearanceContext> = {}): AppearanceContext {
  return {
    palette,
    colorBy: "language",
    blast: null,
    activityColors,
    activity: { nodes: new Map() },
    now: 10_000,
    reducedMotion: false,
    focus: null,
    ...overrides,
  };
}

function node(id: string, overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id,
    label: id.slice(id.lastIndexOf("/") + 1),
    language: "typescript",
    dirKey: id.split("/").slice(0, -1).join("/"),
    inDegree: 0,
    ...overrides,
  };
}

const blast = {
  origin: "src/leaf.ts",
  depths: new Map([
    ["src/mid.ts", 1],
    ["src/top.ts", 2],
    ["src/far.ts", 3],
    ["src/farther.ts", 7],
  ]),
};

describe("nodeSize", () => {
  test("grows with the number of importers inside fixed bounds", () => {
    expect(nodeSize(0)).toBe(MIN_NODE_SIZE);
    expect(nodeSize(4)).toBeGreaterThan(nodeSize(1));
    expect(nodeSize(10_000)).toBe(MAX_NODE_SIZE);
  });
});

describe("colour", () => {
  test("by language uses the language token colour", () => {
    expect(nodeStyle(node("a.rs", { language: "rust" }), context()).color).toBe(palette.language.rust);
    expect(nodeStyle(node("a.py", { language: "python" }), context()).color).toBe(palette.language.python);
  });

  test("by directory gives one colour per folder, drawn from the directory palette", () => {
    const one = nodeStyle(node("src/ui/a.ts"), context({ colorBy: "directory" })).color;
    const same = nodeStyle(node("src/ui/b.ts"), context({ colorBy: "directory" })).color;
    expect(same).toBe(one);
    expect(palette.directories).toContain(one);
  });

  test("by directory separates languages that share a folder from the language scheme", () => {
    const style = nodeStyle(node("src/a.rs", { language: "rust" }), context({ colorBy: "directory" }));
    expect(palette.directories).toContain(style.color);
  });
});

describe("blast radius highlighting", () => {
  const ctx = context({ blast });

  test("the origin uses the accent and is labelled", () => {
    const style = nodeStyle(node("src/leaf.ts"), ctx);
    expect(style.color).toBe(palette.blastOrigin);
    expect(style.forceLabel).toBe(true);
    expect(style.highlighted).toBe(true);
  });

  test("dependents are coloured by depth and clamp beyond the ramp", () => {
    expect(nodeStyle(node("src/mid.ts"), ctx).color).toBe(depthColor(0));
    expect(nodeStyle(node("src/top.ts"), ctx).color).toBe(depthColor(1));
    expect(nodeStyle(node("src/far.ts"), ctx).color).toBe(depthColor(2));
    expect(nodeStyle(node("src/farther.ts"), ctx).color).toBe(depthColor(2));
  });

  test("everything else is dimmed behind the highlighted files", () => {
    const outside = nodeStyle(node("src/unrelated.ts"), ctx);
    const inside = nodeStyle(node("src/mid.ts"), ctx);
    expect(outside.color).toBe(palette.dim);
    expect(outside.zIndex).toBeLessThan(inside.zIndex);
  });

  test("keeps normal colours while the radius is still being computed", () => {
    const loading = context({ blast: { origin: "src/leaf.ts", depths: null } });
    expect(nodeStyle(node("src/unrelated.ts"), loading).color).toBe(palette.language.typescript);
  });

  test("only edges that lead a dependent one step closer to the origin are highlighted", () => {
    const tree = edgeStyle("src/mid.ts", "src/leaf.ts", ctx);
    const next = edgeStyle("src/top.ts", "src/mid.ts", ctx);
    const sideways = edgeStyle("src/top.ts", "src/far.ts", ctx);
    const unrelated = edgeStyle("src/x.ts", "src/y.ts", ctx);
    expect(tree.color).toBe(depthColor(0));
    expect(next.color).toBe(depthColor(1));
    expect(sideways.color).not.toBe(depthColor(1));
    expect(unrelated.size).toBeLessThan(tree.size);
    expect(tree.zIndex).toBeGreaterThan(unrelated.zIndex);
  });
});

describe("hover focus", () => {
  const focus = { node: "src/a.ts", neighbours: new Set(["src/b.ts"]) };
  const ctx = context({ focus });

  test("keeps the hovered node and its neighbours at full colour and dims the rest", () => {
    expect(nodeStyle(node("src/a.ts"), ctx).color).toBe(palette.language.typescript);
    expect(nodeStyle(node("src/b.ts"), ctx).color).toBe(palette.language.typescript);
    const far = nodeStyle(node("src/far.ts"), ctx);
    expect(far.color).not.toBe(palette.language.typescript);
    expect(far.zIndex).toBe(0);
  });

  test("labels and highlights only the hovered node", () => {
    expect(nodeStyle(node("src/a.ts"), ctx).forceLabel).toBe(true);
    expect(nodeStyle(node("src/b.ts"), ctx).forceLabel).toBe(false);
  });

  test("emphasises edges that touch the hovered node", () => {
    expect(edgeStyle("src/a.ts", "src/b.ts", ctx).color).toBe(palette.edgeActive);
    expect(edgeStyle("src/x.ts", "src/y.ts", ctx).size).toBeLessThan(edgeStyle("src/a.ts", "src/b.ts", ctx).size);
  });

  test("does not dim anything in blast mode", () => {
    const withBlast = context({ focus, blast });
    expect(nodeStyle(node("src/mid.ts"), withBlast).color).toBe(depthColor(0));
  });
});

describe("agent activity heat", () => {
  const touchedAt = 10_000;
  const base = nodeStyle(node("src/a.ts"), context());

  function activity(overrides: Partial<NodeActivity> = {}): NodeActivity {
    return {
      reads: 0,
      edits: 1,
      linesChanged: 0,
      lastKind: "edit",
      lastTouchedAt: touchedAt,
      changedTurn: null,
      ...overrides,
    };
  }

  function heated(elapsed: number, overrides: Partial<NodeActivity> = {}, extra: Partial<AppearanceContext> = {}) {
    return nodeStyle(
      node("src/a.ts"),
      context({
        now: touchedAt + elapsed,
        activity: { nodes: new Map([["src/a.ts", activity(overrides)]]) },
        ...extra,
      }),
    );
  }

  test("leaves untouched nodes alone", () => {
    const other = nodeStyle(node("src/b.ts"), context({ activity: { nodes: new Map([["src/a.ts", activity()]]) } }));
    expect(other).toEqual(nodeStyle(node("src/b.ts"), context()));
  });

  test("tints a fresh node towards the colour of what happened to it", () => {
    const edit = heated(0, { lastKind: "edit" });
    const read = heated(0, { lastKind: "read" });
    const editColor = activityColor(activityColors, "edit");
    expect(distance(edit.color, editColor)).toBeLessThan(distance(base.color, editColor));
    expect(edit.color).not.toBe(read.color);
  });

  test("cools slowly towards, but never back to, the resting colour", () => {
    const fresh = heated(TWINKLE_MS);
    const later = heated(10 * 60_000);
    const muchLater = heated(24 * 3_600_000);
    expect(distance(later.color, base.color)).toBeLessThan(distance(fresh.color, base.color));
    expect(distance(muchLater.color, base.color)).toBeGreaterThan(0);
  });

  test("the tint strength is the heat brightness", () => {
    const tint = activityColor(activityColors, "edit");
    expect(heated(60_000).color).toBe(mixColors(base.color, tint, nodeBrightness(60_000, false)));
  });

  test("grows with edits, reads and lines changed, relative to the in-degree size", () => {
    const plain = heated(0, { edits: 0, reads: 0 });
    const edited = heated(0, { edits: 3, linesChanged: 100 });
    expect(plain.size).toBe(base.size);
    expect(edited.size).toBeCloseTo(base.size + 3 * 0.7 + 10 * 0.45, 5);
    expect(heated(0, { edits: 0, reads: 4 }).size).toBeCloseTo(base.size + 1, 5);
  });

  test("never outgrows the maximum node size", () => {
    expect(heated(0, { edits: 500, linesChanged: 1_000_000 }).size).toBe(MAX_NODE_SIZE);
    const hub = nodeStyle(
      node("src/a.ts", { inDegree: 100 }),
      context({ activity: { nodes: new Map([["src/a.ts", activity({ edits: 9 })]]) } }),
    );
    expect(hub.size).toBe(MAX_NODE_SIZE);
  });

  test("forces a label and lifts the node only while it twinkles", () => {
    const hot = heated(1000);
    const cool = heated(TWINKLE_MS + 1);
    expect(hot.forceLabel).toBe(true);
    expect(hot.zIndex).toBeGreaterThan(cool.zIndex);
    expect(cool.forceLabel).toBe(false);
    expect(cool.zIndex).toBeGreaterThan(base.zIndex);
  });

  test("does not twinkle under reduced motion", () => {
    const reduced = heated(275, {}, { reducedMotion: true });
    const tint = activityColor(activityColors, "edit");
    expect(reduced.color).toBe(mixColors(base.color, tint, nodeBrightness(275, true)));
  });

  test("keeps blast colours in blast mode but still grows", () => {
    const style = nodeStyle(
      node("src/mid.ts"),
      context({ blast, now: touchedAt, activity: { nodes: new Map([["src/mid.ts", activity({ edits: 2 })]]) } }),
    );
    expect(style.color).toBe(depthColor(0));
    expect(style.size).toBeGreaterThan(nodeStyle(node("src/mid.ts"), context({ blast })).size);
  });

  test("a hot node is not dimmed by hovering something else", () => {
    const focus = { node: "src/x.ts", neighbours: new Set<string>() };
    const dimmedPlain = nodeStyle(node("src/a.ts"), context({ focus }));
    const hot = heated(500, {}, { focus });
    expect(dimmedPlain.zIndex).toBe(0);
    expect(hot.zIndex).toBe(3);
  });
});

describe("default edges", () => {
  test("are faint and thin until something is focused", () => {
    const style = edgeStyle("src/a.ts", "src/b.ts", context());
    expect(style.size).toBeLessThan(1);
    expect(style.color.startsWith("rgba(")).toBe(true);
  });
});
