import { describe, expect, test } from "bun:test";

import { GlowLayer } from "./glow-layer";
import { graphIndexFor } from "./graph-index";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { fixturePalette } from "./palette-fixture";
import { RecordingPen } from "./pen-fixture";

const FILES = [
  "src/ui/a.tsx",
  "src/ui/b.tsx",
  "src/ui/c.tsx",
  "src/lib/x.ts",
  "src/lib/y.ts",
  "tests/t.test.ts",
  "tests/u.test.ts",
];

const SNAPSHOT: GraphSnapshot = {
  root: "C:/work/app",
  nodes: FILES.map((id) => ({ id, language: "typescript" })),
  edges: [],
  warnings: [],
};

const sigma = { graphToViewport: (point: { x: number; y: number }) => point, getDimensions: () => ({ width: 400, height: 300 }) };
const palette = fixturePalette();

function layer(): GlowLayer {
  const graph = snapshotToGraph(SNAPSHOT, new Map());
  const index = graphIndexFor(SNAPSHOT);
  const glow = new GlowLayer(sigma);
  glow.setIndex(index);
  glow.refit(graph, index);
  return glow;
}

describe("GlowLayer", () => {
  test("washes a glow behind every folder with more than one file", () => {
    const pen = new RecordingPen();
    layer().draw(pen, { colorBy: "role", palette });
    expect(pen.fills).toBeGreaterThanOrEqual(4);
  });

  test("tints by role, by folder, or neutrally for language", () => {
    const stopsFor = (colorBy: "role" | "directory" | "language") => {
      const pen = new RecordingPen();
      layer().draw(pen, { colorBy, palette });
      return pen.stops[0]?.[1];
    };
    expect(new Set([stopsFor("role"), stopsFor("directory"), stopsFor("language")]).size).toBeGreaterThan(1);
  });

  test("is fainter in language mode, where a folder has no single colour", () => {
    const alphaOf = (colorBy: "role" | "language") => {
      const pen = new RecordingPen();
      layer().draw(pen, { colorBy, palette });
      const match = /, ([\d.]+)\)$/.exec(pen.stops[0]?.[1] ?? "");
      return Number(match?.[1]);
    };
    expect(alphaOf("language")).toBeLessThan(alphaOf("role"));
  });

  test("draws nothing without a canvas, and nothing once the index is cleared", () => {
    const glow = layer();
    expect(() => {
      glow.draw(null, { colorBy: "role", palette });
    }).not.toThrow();
    glow.setIndex(null);
    glow.refit(snapshotToGraph(SNAPSHOT, new Map()), null);
    const pen = new RecordingPen();
    glow.draw(pen, { colorBy: "role", palette });
    expect(pen.fills).toBe(0);
  });
});
