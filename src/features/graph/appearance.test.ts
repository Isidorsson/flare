import { describe, expect, test } from "bun:test";

import {
  DUST_MIX,
  FILES_LEVEL_HUB_SCALE,
  FOCUS_DIM_MIX,
  RECEDE_MIX,
  folderColor,
  nodeStyle,
  type AppearanceContext,
  type NodeInfo,
} from "./appearance";
import { mixColors, parseHex } from "./color-math";
import { nodeBrightness, TWINKLE_MS } from "./activity-math";
import { activityColor } from "./activity-palette";
import type { NodeActivity } from "./activity-state";
import { DUST_SIZE, growthCeiling, sizeScale } from "./node-scale";
import { fixtureActivityPalette, fixturePalette } from "./palette-fixture";

const palette = fixturePalette();
const activityColors = fixtureActivityPalette();
const scale = sizeScale(100, 20);

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
    level: "files",
    blast: null,
    activityColors,
    activity: { nodes: new Map() },
    now: 10_000,
    reducedMotion: false,
    focus: null,
    selected: null,
    scale,
    sizeFactor: 1,
    layoutSpan: 100,
    edgeAlpha: 0.3,
    arrows: true,
    ...overrides,
  };
}

function node(id: string, overrides: Partial<NodeInfo> = {}): NodeInfo {
  const folder = id.split("/").slice(0, -1).join("/");
  return {
    id,
    kind: "file",
    label: id.slice(id.lastIndexOf("/") + 1),
    language: "typescript",
    role: "code",
    hub: folder,
    folder,
    size: 5,
    ...overrides,
  };
}

function hub(path: string, overrides: Partial<NodeInfo> = {}): NodeInfo {
  return node(`\u0000folder:${path}`, { kind: "folder", language: null, folder: path, hub: path, size: 6, label: path, ...overrides });
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

const resting = (color: string) => mixColors(color, palette.background, RECEDE_MIX);

describe("colour", () => {
  test("by language uses a calm version of the language colour", () => {
    expect(nodeStyle(node("a.rs", { language: "rust" }), context()).color).toBe(resting(palette.language.rust));
    expect(nodeStyle(node("a.py", { language: "python" }), context()).color).toBe(resting(palette.language.python));
  });

  test("by role uses the role colour", () => {
    const style = nodeStyle(node("src/ui/a.tsx", { role: "frontend" }), context({ colorBy: "role" }));
    expect(style.color).toBe(resting(palette.roles.frontend));
  });

  test("by folder gives one colour per hub, drawn from the folder palette", () => {
    const one = nodeStyle(node("src/ui/a.ts", { hub: "src/ui" }), context({ colorBy: "directory" })).color;
    const same = nodeStyle(node("src/ui/b.ts", { hub: "src/ui" }), context({ colorBy: "directory" })).color;
    expect(same).toBe(one);
    expect(one).toBe(resting(folderColor(palette, "src/ui")));
  });

  test("nodes recede into the background compared with the raw palette colour", () => {
    const raw = palette.language.typescript;
    expect(distance(nodeStyle(node("src/a.ts"), context()).color, palette.background)).toBeLessThan(distance(raw, palette.background));
  });
});

describe("size", () => {
  test("files shrink in a crowded view but dust and activity growth do not", () => {
    const crowded = context({ sizeFactor: 0.5 });
    expect(nodeStyle(node("src/a.ts", { size: 8 }), crowded).size).toBe(4);
    expect(nodeStyle(node("src/a.ts", { size: 8 }), context({ level: "overview", sizeFactor: 0.5 })).size).toBe(DUST_SIZE);
  });

  test("files keep their importance-based size at the files level", () => {
    expect(nodeStyle(node("src/a.ts", { size: 7 }), context()).size).toBe(7);
  });

  test("untouched files are dust in the overview", () => {
    const style = nodeStyle(node("src/a.ts", { size: 7 }), context({ level: "overview" }));
    expect(style.size).toBe(DUST_SIZE);
    expect(style.color).toBe(mixColors(palette.language.typescript, palette.background, DUST_MIX));
  });

  test("a selected, focused or touched file is a full node even in the overview", () => {
    const selected = nodeStyle(node("src/a.ts", { size: 7 }), context({ level: "overview", selected: "src/a.ts" }));
    expect(selected.size).toBe(7);
    const focus = { node: "src/x.ts", neighbours: new Set(["src/a.ts"]) };
    expect(nodeStyle(node("src/a.ts", { size: 7 }), context({ level: "overview", focus })).size).toBe(7);
  });
});

describe("folder hubs", () => {
  test("show only for hubs", () => {
    expect(nodeStyle(hub("src"), context()).hidden).toBe(false);
    expect(nodeStyle(hub("src/deep/er", { hub: "src" }), context()).hidden).toBe(true);
  });

  test("are tinted by role, left neutral when colouring by language, and shrink at the files level", () => {
    const byRole = nodeStyle(hub("src", { role: "api" }), context({ colorBy: "role", level: "overview" }));
    expect(distance(byRole.color, palette.roles.api)).toBeLessThan(distance(palette.roles.api, palette.background));
    const neutral = nodeStyle(hub("src", { role: "api" }), context({ colorBy: "language", level: "overview" }));
    expect(distance(neutral.color, palette.labelDim)).toBeLessThan(distance(neutral.color, palette.roles.api));
    expect(nodeStyle(hub("src"), context({ level: "files" })).size).toBeCloseTo(6 * FILES_LEVEL_HUB_SCALE);
    expect(nodeStyle(hub("src"), context({ level: "overview" })).size).toBe(6);
  });

  test("dim when something else is hovered", () => {
    const focus = { node: "other", neighbours: new Set<string>() };
    expect(nodeStyle(hub("src"), context({ focus })).color).not.toBe(nodeStyle(hub("src"), context()).color);
  });
});

describe("blast radius highlighting", () => {
  const ctx = context({ blast });

  test("the origin uses the accent", () => {
    expect(nodeStyle(node("src/leaf.ts"), ctx).color).toBe(mixColors(palette.blastOrigin, palette.background, RECEDE_MIX));
  });

  test("dependents are coloured by depth and clamp beyond the ramp", () => {
    const expected = (index: number) => mixColors(depthColor(index), palette.background, RECEDE_MIX);
    expect(nodeStyle(node("src/mid.ts"), ctx).color).toBe(expected(0));
    expect(nodeStyle(node("src/top.ts"), ctx).color).toBe(expected(1));
    expect(nodeStyle(node("src/far.ts"), ctx).color).toBe(expected(2));
    expect(nodeStyle(node("src/farther.ts"), ctx).color).toBe(expected(2));
  });

  test("everything else is dimmed behind the highlighted files", () => {
    const outside = nodeStyle(node("src/unrelated.ts"), ctx);
    const inside = nodeStyle(node("src/mid.ts"), ctx);
    expect(outside.color).toBe(resting(palette.dim));
    expect(outside.zIndex).toBeLessThanOrEqual(inside.zIndex);
  });

  test("shows the files in a blast even in the overview", () => {
    const style = nodeStyle(node("src/mid.ts", { size: 7 }), context({ blast, level: "overview" }));
    expect(style.size).toBe(7);
  });
});

describe("hover focus", () => {
  const focus = { node: "src/a.ts", neighbours: new Set(["src/b.ts"]) };
  const ctx = context({ focus });

  test("keeps the hovered node and its neighbours at full colour and dims the rest", () => {
    expect(nodeStyle(node("src/a.ts"), ctx).color).toBe(resting(palette.language.typescript));
    expect(nodeStyle(node("src/b.ts"), ctx).color).toBe(resting(palette.language.typescript));
    const far = nodeStyle(node("src/far.ts"), ctx);
    expect(far.color).toBe(mixColors(resting(palette.language.typescript), palette.background, FOCUS_DIM_MIX));
    expect(far.zIndex).toBe(0);
  });

  test("does not dim anything in blast mode", () => {
    const withBlast = context({ focus, blast });
    expect(nodeStyle(node("src/mid.ts"), withBlast).color).toBe(mixColors(depthColor(0), palette.background, RECEDE_MIX));
  });
});

describe("agent activity heat", () => {
  const touchedAt = 10_000;
  const base = nodeStyle(node("src/a.ts"), context());

  function activity(overrides: Partial<NodeActivity> = {}): NodeActivity {
    return { reads: 0, edits: 1, linesChanged: 0, lastKind: "edit", lastTouchedAt: touchedAt, changedTurn: null, ...overrides };
  }

  function heated(elapsed: number, overrides: Partial<NodeActivity> = {}, extra: Partial<AppearanceContext> = {}) {
    return nodeStyle(
      node("src/a.ts"),
      context({ now: touchedAt + elapsed, activity: { nodes: new Map([["src/a.ts", activity(overrides)]]) }, ...extra }),
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

  test("grows with edits, reads and lines changed, relative to the resting size", () => {
    const plain = heated(0, { edits: 0, reads: 0 });
    const edited = heated(0, { edits: 3, linesChanged: 100 });
    expect(plain.size).toBe(base.size);
    expect(edited.size).toBeCloseTo(base.size + 3 * 0.7 + 10 * 0.45, 5);
    expect(heated(0, { edits: 0, reads: 4 }).size).toBeCloseTo(base.size + 1, 5);
  });

  test("never outgrows the growth ceiling", () => {
    expect(heated(0, { edits: 500, linesChanged: 1_000_000 }).size).toBe(growthCeiling(scale));
  });

  test("lifts the node only while it twinkles, and above anything merely touched", () => {
    const hot = heated(1000);
    const cool = heated(TWINKLE_MS + 1);
    expect(hot.zIndex).toBeGreaterThan(cool.zIndex);
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
    expect(style.color).toBe(mixColors(depthColor(0), palette.background, RECEDE_MIX));
    expect(style.size).toBeGreaterThan(nodeStyle(node("src/mid.ts"), context({ blast })).size);
  });

  test("a hot node is not dimmed by hovering something else", () => {
    const focus = { node: "src/x.ts", neighbours: new Set<string>() };
    const dimmedPlain = nodeStyle(node("src/a.ts"), context({ focus }));
    const hot = heated(500, {}, { focus });
    expect(dimmedPlain.zIndex).toBe(0);
    expect(hot.zIndex).toBe(3);
  });

  test("a touched file stands out in the overview instead of fading into dust", () => {
    const style = nodeStyle(
      node("src/a.ts"),
      context({ level: "overview", now: touchedAt, activity: { nodes: new Map([["src/a.ts", activity()]]) } }),
    );
    expect(style.size).toBeGreaterThan(DUST_SIZE);
  });
});
