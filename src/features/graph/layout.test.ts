import { describe, expect, test } from "bun:test";

import { folderId } from "./directory-tree";
import { readPositions, type CodeGraph } from "./graph-model";
import { snapshotToGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { placementBodies, startLayout, type LayoutOptions, type LayoutScheduler } from "./layout";
import { unitsPerPixel } from "./layout-params";
import type { Point } from "./placement";

function ringSnapshot(size: number): GraphSnapshot {
  const ids = Array.from({ length: size }, (_, index) => `src/dir${index % 3}/file${index}.ts`);
  return {
    root: "C:/app",
    nodes: ids.map((id) => ({ id, language: "typescript" })),
    edges: ids.map((id, index) => ({ source: id, target: ids[(index + 1) % size] ?? id })),
    warnings: [],
  };
}

function fakeScheduler(msPerClockRead: number) {
  const queue = new Map<number, () => void>();
  let nextHandle = 1;
  let time = 0;
  const scheduler: LayoutScheduler = {
    requestFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      queue.delete(handle);
    },
    now: () => {
      time += msPerClockRead;
      return time;
    },
  };
  function runFrame(): boolean {
    const [first] = queue.entries();
    if (first === undefined) return false;
    queue.delete(first[0]);
    first[1]();
    return true;
  }
  return { scheduler, runFrame, pending: () => queue.size };
}

function runToCompletion(runFrame: () => boolean, limit = 10_000): number {
  let frames = 0;
  while (frames < limit && runFrame()) frames += 1;
  return frames;
}

function options(scheduler: LayoutScheduler, overrides: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    rounds: 20,
    animate: true,
    viewportPx: 400,
    scheduler,
    onFrame: () => undefined,
    onDone: () => undefined,
    ...overrides,
  };
}

function nodeDistance(graph: CodeGraph, first: string, second: string): number {
  const a = graph.getNodeAttributes(first);
  const b = graph.getNodeAttributes(second);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("unitsPerPixel", () => {
  test("is the layout span per usable pixel, with room to grow", () => {
    expect(unitsPerPixel(1000, 472)).toBeGreaterThan(1000 / 400);
    expect(unitsPerPixel(1000, 872)).toBeLessThan(unitsPerPixel(1000, 472));
  });

  test("survives an empty or unmeasured layout", () => {
    expect(unitsPerPixel(0, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(unitsPerPixel(500, -5))).toBe(true);
  });
});

describe("placementBodies", () => {
  test("gives shown nodes a radius and hidden folders none", () => {
    const graph = snapshotToGraph(ringSnapshot(6), new Map());
    const { ids, bodies } = placementBodies(graph, 400);
    const index = ids.indexOf("src/dir0/file0.ts");
    expect(bodies.radii[index]).toBeGreaterThan(0);
    graph.setNodeAttribute(folderId("src/dir0"), "hub", "src");
    const hidden = placementBodies(graph, 400);
    expect(hidden.bodies.radii[hidden.ids.indexOf(folderId("src/dir0"))]).toBe(0);
  });

  test("makes pixel-sized radii larger when the layout is wider", () => {
    const graph = snapshotToGraph(ringSnapshot(6), new Map());
    const narrow = placementBodies(graph, 400);
    graph.updateEachNodeAttributes((_, attributes) => ({ ...attributes, x: attributes.x * 10, y: attributes.y * 10 }));
    const wide = placementBodies(graph, 400);
    const index = narrow.ids.indexOf("src/dir0/file0.ts");
    expect(wide.bodies.radii[index] ?? 0).toBeGreaterThan((narrow.bodies.radii[index] ?? 0) * 5);
  });
});

describe("startLayout", () => {
  test("spreads the work over several frames and then reports completion exactly once", () => {
    const graph = snapshotToGraph(ringSnapshot(40), new Map());
    const before = readPositions(graph);
    const fake = fakeScheduler(4);
    let frames = 0;
    let done = 0;
    startLayout(
      graph,
      options(fake.scheduler, {
        onFrame: () => {
          frames += 1;
        },
        onDone: () => {
          done += 1;
        },
      }),
    );
    expect(done).toBe(0);
    runToCompletion(fake.runFrame);
    expect(done).toBe(1);
    expect(frames).toBeGreaterThan(1);
    expect(fake.pending()).toBe(0);
    expect(readPositions(graph)).not.toEqual(before);
  });

  test("is bounded: it stops scheduling frames once the rounds and untangling are done", () => {
    const graph = snapshotToGraph(ringSnapshot(24), new Map());
    const fake = fakeScheduler(100);
    startLayout(graph, options(fake.scheduler, { rounds: 10 }));
    expect(runToCompletion(fake.runFrame)).toBeLessThan(200);
    expect(fake.pending()).toBe(0);
  });

  test("keeps every position finite", () => {
    const graph = snapshotToGraph(ringSnapshot(60), new Map());
    const fake = fakeScheduler(1);
    startLayout(graph, options(fake.scheduler, { animate: false }));
    runToCompletion(fake.runFrame);
    for (const point of readPositions(graph).values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  test("leaves no two shown nodes overlapping once it is done", () => {
    const graph = snapshotToGraph(ringSnapshot(60), new Map());
    const fake = fakeScheduler(1);
    startLayout(graph, options(fake.scheduler, { animate: false }));
    runToCompletion(fake.runFrame);
    const { ids, bodies } = placementBodies(graph, 400);
    let deepest = 0;
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        const distance = Math.hypot((bodies.xs[first] ?? 0) - (bodies.xs[second] ?? 0), (bodies.ys[first] ?? 0) - (bodies.ys[second] ?? 0));
        deepest = Math.max(deepest, (bodies.radii[first] ?? 0) + (bodies.radii[second] ?? 0) - distance);
      }
    }
    const perPixel = unitsPerPixel(Math.max(...[...readPositions(graph).values()].map((point: Point) => Math.abs(point.x))) * 2, 400);
    expect(deepest).toBeLessThan(perPixel * 1.5);
  });

  test("keeps the files of a folder nearer to their hub than to another folder's hub", () => {
    const graph = snapshotToGraph(ringSnapshot(60), new Map());
    const fake = fakeScheduler(1);
    startLayout(graph, options(fake.scheduler, { animate: false }));
    runToCompletion(fake.runFrame);
    const own = nodeDistance(graph, "src/dir0/file0.ts", folderId("src/dir0"));
    const other = nodeDistance(graph, "src/dir0/file0.ts", folderId("src/dir1"));
    expect(own).toBeLessThan(other);
  });

  test("does not report frames when animation is off but still completes", () => {
    const graph = snapshotToGraph(ringSnapshot(10), new Map());
    const fake = fakeScheduler(4);
    let frames = 0;
    let done = 0;
    startLayout(
      graph,
      options(fake.scheduler, {
        animate: false,
        onFrame: () => {
          frames += 1;
        },
        onDone: () => {
          done += 1;
        },
      }),
    );
    runToCompletion(fake.runFrame);
    expect(frames).toBe(0);
    expect(done).toBe(1);
  });

  test("cancel stops the run before completion", () => {
    const graph = snapshotToGraph(ringSnapshot(10), new Map());
    const fake = fakeScheduler(50);
    let done = 0;
    const run = startLayout(
      graph,
      options(fake.scheduler, {
        rounds: 400,
        onDone: () => {
          done += 1;
        },
      }),
    );
    fake.runFrame();
    run.cancel();
    expect(fake.pending()).toBe(0);
    expect(runToCompletion(fake.runFrame)).toBe(0);
    expect(done).toBe(0);
  });

  test("finishes immediately for graphs too small to lay out", () => {
    const graph = snapshotToGraph({ root: "C:/app", nodes: [], edges: [], warnings: [] }, new Map());
    const fake = fakeScheduler(1);
    let done = 0;
    startLayout(
      graph,
      options(fake.scheduler, {
        onDone: () => {
          done += 1;
        },
      }),
    );
    expect(done).toBe(1);
    expect(fake.pending()).toBe(0);
  });
});
