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
import { parseHex } from "./color-math";
import { fixturePalette } from "./palette-fixture";
import { PULSE_DURATION_MS } from "./pulse";

const palette = fixturePalette();

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
    pulses: new Map(),
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

describe("pulse glow and fade", () => {
  const start = 10_000;
  const base = nodeStyle(node("src/a.ts"), context());

  function pulsed(elapsed: number, reducedMotion = false) {
    return nodeStyle(
      node("src/a.ts"),
      context({
        now: start + elapsed,
        reducedMotion,
        pulses: new Map([["src/a.ts", { kind: "change", startedAt: start }]]),
      }),
    );
  }

  test("starts at full glow: pulse colour, larger, labelled and on top", () => {
    const fresh = pulsed(0);
    expect(fresh.color).toBe(palette.pulse.change);
    expect(fresh.size).toBeGreaterThan(base.size);
    expect(fresh.forceLabel).toBe(true);
    expect(fresh.zIndex).toBeGreaterThan(base.zIndex);
  });

  test("fades back towards the resting appearance", () => {
    const early = pulsed(PULSE_DURATION_MS * 0.2);
    const late = pulsed(PULSE_DURATION_MS * 0.9);
    expect(early.size).toBeGreaterThan(late.size);
    expect(late.size).toBeGreaterThan(base.size);
    expect(distance(early.color, base.color)).toBeGreaterThan(distance(late.color, base.color));
    expect(distance(late.color, base.color)).toBeGreaterThan(0);
  });

  test("is back to the resting appearance once expired", () => {
    expect(pulsed(PULSE_DURATION_MS)).toEqual(base);
    expect(pulsed(PULSE_DURATION_MS * 3)).toEqual(base);
  });

  test("reads and changes glow in different colours", () => {
    const read = nodeStyle(
      node("src/a.ts"),
      context({ pulses: new Map([["src/a.ts", { kind: "read", startedAt: start }]]) }),
    );
    expect(read.color).toBe(palette.pulse.read);
    expect(read.color).not.toBe(palette.pulse.change);
  });

  test("respects reduced motion: no size animation, steady colour for the whole duration", () => {
    const early = pulsed(0, true);
    const late = pulsed(PULSE_DURATION_MS * 0.9, true);
    expect(early.size).toBe(base.size);
    expect(late.size).toBe(base.size);
    expect(early.color).toBe(late.color);
    expect(early.color).toBe(palette.pulse.change);
    expect(pulsed(PULSE_DURATION_MS, true)).toEqual(base);
  });

  test("ignores pulses for other files", () => {
    const other = nodeStyle(
      node("src/b.ts"),
      context({ pulses: new Map([["src/a.ts", { kind: "change", startedAt: start }]]) }),
    );
    expect(other).toEqual(nodeStyle(node("src/b.ts"), context()));
  });
});

describe("default edges", () => {
  test("are faint and thin until something is focused", () => {
    const style = edgeStyle("src/a.ts", "src/b.ts", context());
    expect(style.size).toBeLessThan(1);
    expect(style.color.startsWith("rgba(")).toBe(true);
  });
});
