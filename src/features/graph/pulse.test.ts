import { describe, expect, test } from "bun:test";

import { isPulseActive, pulseIntensity, PULSE_DURATION_MS, type Pulse } from "./pulse";

const pulse: Pulse = { kind: "change", startedAt: 1000 };

describe("pulseIntensity", () => {
  test("starts at full strength", () => {
    expect(pulseIntensity(pulse, 1000, false)).toBe(1);
  });

  test("decays monotonically to zero", () => {
    const samples = [0, 0.25, 0.5, 0.75, 0.99].map((fraction) =>
      pulseIntensity(pulse, 1000 + PULSE_DURATION_MS * fraction, false),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1] ?? 0);
    }
    expect(samples.at(-1)).toBeGreaterThan(0);
  });

  test("is zero once the duration has elapsed", () => {
    expect(pulseIntensity(pulse, 1000 + PULSE_DURATION_MS, false)).toBe(0);
    expect(pulseIntensity(pulse, 1000 + PULSE_DURATION_MS * 5, false)).toBe(0);
  });

  test("is zero before the pulse starts (clock skew)", () => {
    expect(pulseIntensity(pulse, 999, false)).toBe(0);
  });

  test("holds steady instead of fading under reduced motion", () => {
    expect(pulseIntensity(pulse, 1000 + PULSE_DURATION_MS * 0.9, true)).toBe(1);
    expect(pulseIntensity(pulse, 1000 + PULSE_DURATION_MS, true)).toBe(0);
  });
});

describe("isPulseActive", () => {
  test("is true strictly inside the duration", () => {
    expect(isPulseActive(pulse, 1000)).toBe(true);
    expect(isPulseActive(pulse, 1000 + PULSE_DURATION_MS - 1)).toBe(true);
    expect(isPulseActive(pulse, 1000 + PULSE_DURATION_MS)).toBe(false);
  });
});
