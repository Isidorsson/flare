import { describe, expect, test } from "bun:test";

import { createSeparator, maxRadius, type Bodies } from "./separation";

function bodies(points: readonly [number, number, number][]): Bodies {
  return {
    xs: Float64Array.from(points.map(([x]) => x)),
    ys: Float64Array.from(points.map(([, y]) => y)),
    radii: Float64Array.from(points.map(([, , r]) => r)),
  };
}

function deepestOverlap(input: Bodies, gap: number): number {
  let deepest = 0;
  for (let first = 0; first < input.xs.length; first += 1) {
    for (let second = first + 1; second < input.xs.length; second += 1) {
      const distance = Math.hypot(
        (input.xs[first] ?? 0) - (input.xs[second] ?? 0),
        (input.ys[first] ?? 0) - (input.ys[second] ?? 0),
      );
      deepest = Math.max(deepest, (input.radii[first] ?? 0) + (input.radii[second] ?? 0) + gap - distance);
    }
  }
  return deepest;
}

describe("separator", () => {
  test("pushes two overlapping circles apart along their axis", () => {
    const input = bodies([
      [0, 0, 5],
      [4, 0, 5],
    ]);
    const left = createSeparator(input, 1).step(50);
    expect(left).toBe(0);
    expect(deepestOverlap(input, 1)).toBeLessThan(0.02);
    expect(input.ys[0]).toBeCloseTo(0);
    expect((input.xs[1] ?? 0) - (input.xs[0] ?? 0)).toBeGreaterThanOrEqual(10.9);
  });

  test("moves the small circle further than the big one", () => {
    const input = bodies([
      [0, 0, 10],
      [5, 0, 1],
    ]);
    createSeparator(input, 0).step(50);
    expect(Math.abs(input.xs[0] ?? 0)).toBeLessThan(Math.abs((input.xs[1] ?? 0) - 5));
  });

  test("lets a heavy body hold its ground while a light one is pushed away", () => {
    const input = {
      ...bodies([
        [0, 0, 5],
        [3, 0, 5],
      ]),
      masses: Float64Array.from([1e6, 1]),
    };
    createSeparator(input, 0).step(50);
    expect(Math.abs(input.xs[0] ?? 1)).toBeLessThan(0.01);
    expect((input.xs[1] ?? 0) - (input.xs[0] ?? 0)).toBeGreaterThanOrEqual(9.9);
  });

  test("untangles a dense cluster", () => {
    const points: [number, number, number][] = Array.from({ length: 120 }, (_, index) => [
      Math.cos(index) * (index % 7),
      Math.sin(index) * (index % 7),
      1.5,
    ]);
    const input = bodies(points);
    const separator = createSeparator(input, 0.5);
    separator.step(400);
    expect(deepestOverlap(input, 0.5)).toBeLessThan(0.1);
  });

  test("separates circles that start on exactly the same spot", () => {
    const input = bodies([
      [3, 3, 2],
      [3, 3, 2],
      [3, 3, 2],
    ]);
    createSeparator(input, 0).step(100);
    expect(deepestOverlap(input, 0)).toBeLessThan(0.05);
  });

  test("leaves circles that do not touch alone and reports no overlap", () => {
    const input = bodies([
      [0, 0, 1],
      [10, 0, 1],
    ]);
    expect(createSeparator(input, 1).step(5)).toBe(0);
    expect(input.xs[1]).toBe(10);
  });

  test("copes with no bodies", () => {
    const empty = bodies([]);
    expect(maxRadius(empty)).toBe(0);
    expect(createSeparator(empty, 1).step(3)).toBe(0);
  });
});
