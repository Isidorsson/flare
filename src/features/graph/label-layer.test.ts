import { beforeEach, describe, expect, test } from "bun:test";

import { fixtureActivityPalette, fixturePalette } from "./palette-fixture";
import { folderId } from "./directory-tree";
import type { GraphApi } from "./graph-api";
import { graphIndexFor } from "./graph-index";
import type { CodeGraph } from "./graph-model";
import { createGraphStore, type GraphStore } from "./graph-store";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { LabelLayer, type LabelSigma } from "./label-layer";
import { RecordingPen } from "./pen-fixture";
import type { Point } from "./placement";

const NOW = 5000;
const SNAPSHOT: GraphSnapshot = {
  root: "C:/work/acme",
  nodes: ["src/app/main.ts", "src/lib/cart.ts", "src/lib/money.ts", "tests/cart.test.ts"].map((id) => ({
    id,
    language: "typescript",
  })),
  edges: [{ source: "src/app/main.ts", target: "src/lib/cart.ts" }],
  warnings: [],
};

const POSITIONS: ReadonlyMap<string, Point> = new Map([
  [folderId(""), { x: 200, y: 20 }],
  [folderId("src"), { x: 200, y: 80 }],
  [folderId("src/app"), { x: 100, y: 160 }],
  [folderId("src/lib"), { x: 300, y: 160 }],
  [folderId("tests"), { x: 200, y: 260 }],
  ["src/app/main.ts", { x: 90, y: 200 }],
  ["src/lib/cart.ts", { x: 300, y: 200 }],
  ["src/lib/money.ts", { x: 330, y: 190 }],
  ["tests/cart.test.ts", { x: 200, y: 280 }],
]);

function makeStore(): GraphStore {
  const api: GraphApi = {
    build: () => Promise.resolve(SNAPSHOT),
    snapshot: () => Promise.resolve(SNAPSHOT),
    blastRadius: (path) => Promise.resolve({ origin: path, nodes: [] }),
    updateFile: () => Promise.resolve("unchanged"),
    removeFile: () => Promise.resolve("unchanged"),
  };
  return createGraphStore({ api, now: () => NOW });
}

function makeSigma(graph: CodeGraph): LabelSigma {
  return {
    getDimensions: () => ({ width: 400, height: 320 }),
    graphToViewport: (point) => point,
    scaleSize: (size = 0) => size,
    getNodeDisplayData: (id) => {
      if (!graph.hasNode(id)) return undefined;
      const attributes = graph.getNodeAttributes(id);
      return { size: attributes.size, hidden: attributes.kind === "folder" && attributes.hub !== attributes.folder };
    },
    getCamera: () => ({ getState: () => ({ ratio: 1 }) }),
  };
}

interface Harness {
  store: GraphStore;
  pen: RecordingPen;
  layer: LabelLayer;
  graph: CodeGraph;
}

async function harness(): Promise<Harness> {
  const store = makeStore();
  await store.getState().load("C:\\work\\acme");
  const graph = snapshotToGraph(SNAPSHOT, POSITIONS);
  const pen = new RecordingPen();
  const layer = new LabelLayer({
    sigma: makeSigma(graph),
    graph,
    store,
    palette: fixturePalette(),
    colors: fixtureActivityPalette(),
    layer: () => pen,
    now: () => NOW,
  });
  layer.setIndex(graphIndexFor(SNAPSHOT));
  return { store, pen, layer, graph };
}

let h: Harness;

beforeEach(async () => {
  h = await harness();
});

describe("overview labels", () => {
  test("names every folder hub with its file count, and the root by project name", () => {
    h.layer.draw();
    expect(h.pen.texts).toContain("acme");
    expect(h.pen.texts).toContain("src/");
    expect(h.pen.texts).toContain("lib/");
    expect(h.pen.texts).toContain("app/");
    expect(h.pen.texts).toContain("2");
  });

  test("labels no ordinary files", () => {
    h.layer.draw();
    expect(h.pen.texts).not.toContain("cart.ts");
    expect(h.pen.texts).not.toContain("money.ts");
  });

  test("draws nothing before an index exists", () => {
    h.layer.setIndex(null);
    h.layer.draw();
    expect(h.pen.texts).toHaveLength(0);
  });

  test("never lays one label on top of another", () => {
    h.layer.draw();
    const rects = h.pen.rects;
    for (const [index, first] of rects.entries()) {
      for (const second of rects.slice(index + 1)) {
        const overlap =
          first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("files level", () => {
  test("adds file labels for the important files", () => {
    h.store.getState().setLevel("files");
    h.layer.draw();
    expect(h.pen.texts).toContain("cart.ts");
  });
});

describe("activity", () => {
  test("labels a touched file in the colour of what happened to it and marks it with a spark", () => {
    h.store.getState().recordActivity({ path: "src/lib/money.ts", kind: "edit", linesChanged: 4 });
    h.layer.draw();
    expect(h.pen.texts).toContain("money.ts");
    expect(h.pen.stops.length).toBeGreaterThan(0);
    expect(h.pen.fills).toBeGreaterThan(0);
  });

  test("shows what the agent did in a hub next to its name", () => {
    h.store.getState().recordActivity({ path: "src/lib/money.ts", kind: "edit", linesChanged: 4 });
    h.store.getState().recordActivity({ path: "src/lib/cart.ts", kind: "read" });
    h.layer.draw();
    expect(h.pen.texts).toContain("1 edited · 1 read");
  });

  test("keeps labelling the hovered node", () => {
    h.layer.setFocus({ node: "src/lib/cart.ts", neighbours: new Set(["src/app/main.ts"]) });
    h.layer.draw();
    expect(h.pen.texts).toContain("cart.ts");
    expect(h.pen.texts).toContain("main.ts");
  });
});
