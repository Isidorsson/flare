import { describe, expect, test } from "bun:test";

import { snapshotToGraph, readPositions } from "./graph-model";
import type { GraphSnapshot } from "./graph-types";
import {
  layoutIterations,
  MAX_LAYOUT_ITERATIONS,
  MIN_LAYOUT_ITERATIONS,
  startLayout,
  type LayoutScheduler,
} from "./layout";

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

describe("layoutIterations", () => {
  test("gives small graphs the maximum and large graphs the minimum", () => {
    expect(layoutIterations(10)).toBe(MAX_LAYOUT_ITERATIONS);
    expect(layoutIterations(1_000_000)).toBe(MIN_LAYOUT_ITERATIONS);
  });

  test("never increases with graph size", () => {
    const sizes = [50, 200, 500, 1000, 5000];
    const counts = sizes.map(layoutIterations);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeLessThanOrEqual(counts[index - 1] ?? 0);
    }
  });
});

describe("startLayout", () => {
  test("spreads the work over several frames and then reports completion exactly once", () => {
    const graph = snapshotToGraph(ringSnapshot(12), new Map());
    const before = readPositions(graph);
    const fake = fakeScheduler(4);
    let frames = 0;
    let done = 0;
    startLayout(graph, {
      iterations: 100,
      animate: true,
      scheduler: fake.scheduler,
      onFrame: () => {
        frames += 1;
      },
      onDone: () => {
        done += 1;
      },
    });
    expect(done).toBe(0);
    runToCompletion(fake.runFrame);
    expect(done).toBe(1);
    expect(frames).toBeGreaterThan(1);
    expect(fake.pending()).toBe(0);
    expect(readPositions(graph)).not.toEqual(before);
  });

  test("is bounded: it stops scheduling frames after the requested iterations", () => {
    const graph = snapshotToGraph(ringSnapshot(8), new Map());
    const fake = fakeScheduler(100);
    startLayout(graph, {
      iterations: 40,
      animate: true,
      scheduler: fake.scheduler,
      onFrame: () => undefined,
      onDone: () => undefined,
    });
    expect(runToCompletion(fake.runFrame)).toBeLessThanOrEqual(40);
    expect(fake.pending()).toBe(0);
  });

  test("keeps every position finite", () => {
    const graph = snapshotToGraph(ringSnapshot(30), new Map());
    const fake = fakeScheduler(1);
    startLayout(graph, {
      iterations: 200,
      animate: false,
      scheduler: fake.scheduler,
      onFrame: () => undefined,
      onDone: () => undefined,
    });
    runToCompletion(fake.runFrame);
    for (const point of readPositions(graph).values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  test("does not report frames when animation is off but still completes", () => {
    const graph = snapshotToGraph(ringSnapshot(10), new Map());
    const fake = fakeScheduler(4);
    let frames = 0;
    let done = 0;
    startLayout(graph, {
      iterations: 60,
      animate: false,
      scheduler: fake.scheduler,
      onFrame: () => {
        frames += 1;
      },
      onDone: () => {
        done += 1;
      },
    });
    runToCompletion(fake.runFrame);
    expect(frames).toBe(0);
    expect(done).toBe(1);
  });

  test("cancel stops the run before completion", () => {
    const graph = snapshotToGraph(ringSnapshot(10), new Map());
    const fake = fakeScheduler(50);
    let done = 0;
    const run = startLayout(graph, {
      iterations: 400,
      animate: true,
      scheduler: fake.scheduler,
      onFrame: () => undefined,
      onDone: () => {
        done += 1;
      },
    });
    fake.runFrame();
    run.cancel();
    expect(fake.pending()).toBe(0);
    expect(runToCompletion(fake.runFrame)).toBe(0);
    expect(done).toBe(0);
  });

  test("finishes immediately for graphs too small to lay out", () => {
    const graph = snapshotToGraph(ringSnapshot(1), new Map());
    const fake = fakeScheduler(1);
    let done = 0;
    startLayout(graph, {
      iterations: 100,
      animate: true,
      scheduler: fake.scheduler,
      onFrame: () => undefined,
      onDone: () => {
        done += 1;
      },
    });
    expect(done).toBe(1);
    expect(fake.pending()).toBe(0);
  });
});
