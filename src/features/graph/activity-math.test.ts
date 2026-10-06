import { describe, expect, test } from "bun:test";

import {
  activityBonus,
  easeOutCubic,
  frameFraction,
  grownSize,
  heatBrightness,
  HEAT_FLOOR,
  HEAT_TAU_MS,
  isTwinkling,
  lerp,
  nodeBrightness,
  TWINKLE_MIN,
  TWINKLE_MS,
  TWINKLE_PERIOD_MS,
  twinkleFactor,
} from "./activity-math";

describe("heatBrightness", () => {
  test("is full at the moment of the touch", () => {
    expect(heatBrightness(0)).toBe(1);
  });

  test("follows 0.38 + 0.62 * exp(-dt / 300s)", () => {
    expect(heatBrightness(HEAT_TAU_MS)).toBeCloseTo(HEAT_FLOOR + (1 - HEAT_FLOOR) * Math.exp(-1), 10);
    expect(heatBrightness(150_000)).toBeCloseTo(0.38 + 0.62 * Math.exp(-0.5), 10);
  });

  test("cools monotonically but never reaches zero", () => {
    let previous = heatBrightness(0);
    for (const seconds of [1, 10, 60, 300, 900, 1800]) {
      const next = heatBrightness(seconds * 1000);
      expect(next).toBeLessThan(previous);
      expect(next).toBeGreaterThan(HEAT_FLOOR);
      previous = next;
    }
    expect(heatBrightness(86_400_000)).toBeGreaterThanOrEqual(HEAT_FLOOR);
  });

  test("treats a clock that ran backwards as just touched", () => {
    expect(heatBrightness(-500)).toBe(1);
  });
});

describe("twinkle", () => {
  test("only lasts eight seconds", () => {
    expect(isTwinkling(0)).toBe(true);
    expect(isTwinkling(TWINKLE_MS - 1)).toBe(true);
    expect(isTwinkling(TWINKLE_MS)).toBe(false);
    expect(isTwinkling(-1)).toBe(false);
  });

  test("stays between 0.85 and 1 and repeats every 1.1 s", () => {
    for (let elapsed = 0; elapsed < TWINKLE_MS; elapsed += 37) {
      const factor = twinkleFactor(elapsed);
      expect(factor).toBeGreaterThanOrEqual(TWINKLE_MIN - 1e-9);
      expect(factor).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(twinkleFactor(300)).toBeCloseTo(twinkleFactor(300 + TWINKLE_PERIOD_MS), 9);
  });

  test("reaches both extremes", () => {
    expect(twinkleFactor(TWINKLE_PERIOD_MS / 4)).toBeCloseTo(1, 9);
    expect(twinkleFactor((TWINKLE_PERIOD_MS * 3) / 4)).toBeCloseTo(TWINKLE_MIN, 9);
  });

  test("is neutral once it has ended", () => {
    expect(twinkleFactor(TWINKLE_MS + 10)).toBe(1);
  });

  test("brightness multiplies heat by the twinkle, and drops the twinkle under reduced motion", () => {
    const elapsed = (TWINKLE_PERIOD_MS * 3) / 4;
    expect(nodeBrightness(elapsed, false)).toBeCloseTo(heatBrightness(elapsed) * TWINKLE_MIN, 9);
    expect(nodeBrightness(elapsed, true)).toBe(heatBrightness(elapsed));
  });
});

describe("activity size", () => {
  const none = { reads: 0, edits: 0, linesChanged: 0 };

  test("adds sqrt(lines) * 0.45 + edits * 0.7 + reads * 0.25 to the base size", () => {
    expect(activityBonus({ reads: 4, edits: 2, linesChanged: 64 })).toBeCloseTo(8 * 0.45 + 1.4 + 1, 10);
    expect(grownSize(3, { reads: 4, edits: 2, linesChanged: 64 }, 11)).toBeCloseTo(3 + 8 * 0.45 + 1.4 + 1, 10);
  });

  test("an untouched node keeps its base size", () => {
    expect(grownSize(5, none, 11)).toBe(5);
  });

  test("is capped at the maximum", () => {
    expect(grownSize(3, { reads: 0, edits: 100, linesChanged: 0 }, 11)).toBe(11);
  });

  test("ignores negative line counts", () => {
    expect(activityBonus({ reads: 0, edits: 0, linesChanged: -9 })).toBe(0);
  });
});

describe("easing helpers", () => {
  test("frameFraction equals the per-frame fraction at 60 fps and compounds over longer frames", () => {
    expect(frameFraction(0.09, 1000 / 60)).toBeCloseTo(0.09, 10);
    const twoFrames = 1 - (1 - 0.09) * (1 - 0.09);
    expect(frameFraction(0.09, 2000 / 60)).toBeCloseTo(twoFrames, 10);
    expect(frameFraction(0.09, 0)).toBe(0);
  });

  test("easeOutCubic is fast first, clamped, and hits both ends", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });

  test("lerp interpolates", () => {
    expect(lerp(6, 34, 0.5)).toBe(20);
  });
});
