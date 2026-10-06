import { describe, expect, test } from "bun:test";

import { DUST_SIZE, fitSizeFactor, fileSize, growthCeiling, hubSize, importanceOf, sizeScale } from "./node-scale";

describe("importance", () => {
  test("weighs dependents above dependencies", () => {
    expect(importanceOf(10, 0)).toBeGreaterThan(importanceOf(0, 10));
    expect(importanceOf(0, 0)).toBe(0);
  });
});

describe("size scale", () => {
  test("shrinks as the project grows", () => {
    const small = sizeScale(20, 10);
    const medium = sizeScale(300, 10);
    const large = sizeScale(2000, 10);
    expect(small.min).toBeGreaterThan(medium.min);
    expect(medium.min).toBeGreaterThan(large.min);
    expect(small.max).toBeGreaterThan(large.max);
  });

  test("stays inside its range for any project size", () => {
    for (const files of [0, 1, 24, 2400, 100_000]) {
      const scale = sizeScale(files, 5);
      expect(scale.min).toBeGreaterThan(1);
      expect(scale.max).toBeGreaterThan(scale.min);
    }
  });

  test("makes leaves small and hubs big within the same graph", () => {
    const scale = sizeScale(500, 120);
    expect(fileSize(0, scale)).toBeCloseTo(scale.min);
    expect(fileSize(120, scale)).toBeCloseTo(scale.max);
    expect(fileSize(5, scale)).toBeGreaterThan(fileSize(1, scale));
    expect(fileSize(5, scale)).toBeLessThan(fileSize(60, scale));
  });

  test("caps anything beyond the reference importance", () => {
    const scale = sizeScale(500, 40);
    expect(fileSize(4000, scale)).toBeCloseTo(scale.max);
  });

  test("copes with a graph that has no edges", () => {
    const scale = sizeScale(10, 0);
    expect(fileSize(0, scale)).toBeCloseTo(scale.min);
  });
});

describe("fitSizeFactor", () => {
  test("leaves files alone when there is plenty of room", () => {
    expect(fitSizeFactor(10, sizeScale(100, 10))).toBe(1);
  });

  test("shrinks files as the fitted view gets more crowded", () => {
    const scale = sizeScale(2000, 10);
    expect(fitSizeFactor(1, scale)).toBeLessThan(fitSizeFactor(2, scale));
    expect(fitSizeFactor(0.6, scale)).toBeLessThan(1);
  });

  test("never shrinks files out of sight", () => {
    expect(fitSizeFactor(0.0001, sizeScale(2000, 10))).toBe(0.4);
    expect(fitSizeFactor(-3, sizeScale(2000, 10))).toBe(0.4);
  });
});

describe("hub size and growth", () => {
  test("hubs grow with their file count but are capped", () => {
    expect(hubSize(1)).toBeLessThan(hubSize(15));
    expect(hubSize(15)).toBeLessThan(hubSize(300));
    expect(hubSize(10_000_000)).toBeLessThanOrEqual(11);
  });

  test("dust is smaller than any file or hub", () => {
    expect(DUST_SIZE).toBeLessThan(sizeScale(2400, 1).min);
    expect(DUST_SIZE).toBeLessThan(hubSize(1));
  });

  test("lets activity grow a node beyond the largest hub node", () => {
    const scale = sizeScale(300, 20);
    expect(growthCeiling(scale)).toBeGreaterThan(scale.max);
  });
});
