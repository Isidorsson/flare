import { describe, expect, test } from "bun:test";

import { clamp01, fromHsl, mixColors, muteColor, parseHex, toHsl, withAlpha, withPremultipliedAlpha } from "./color-math";

describe("color math", () => {
  test("parses #rrggbb in either case with surrounding whitespace", () => {
    expect(parseHex(" #FF6a33 ")).toEqual({ r: 255, g: 106, b: 51 });
  });

  test("rejects anything that is not #rrggbb", () => {
    for (const bad of ["", "red", "#fff", "rgb(1,2,3)", "#gggggg", "#12345678"]) {
      expect(() => parseHex(bad)).toThrow();
    }
  });

  test("mixes channels linearly", () => {
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColors("#102030", "#102030", 0.7)).toBe("#102030");
  });

  test("clamps the mix amount", () => {
    expect(mixColors("#000000", "#ffffff", -3)).toBe("#000000");
    expect(mixColors("#000000", "#ffffff", 9)).toBe("#ffffff");
    expect(clamp01(0.25)).toBe(0.25);
  });

  test("round-trips through hsl", () => {
    for (const color of ["#ff6a33", "#6aa7ff", "#5fd38d", "#0b0c0f", "#e9e7e4"]) {
      expect(fromHsl(toHsl(color))).toBe(color);
    }
  });

  test("reads the primary hues", () => {
    expect(toHsl("#ff0000").h).toBeCloseTo(0);
    expect(toHsl("#00ff00").h).toBeCloseTo(120);
    expect(toHsl("#0000ff").h).toBeCloseTo(240);
    expect(toHsl("#808080")).toEqual({ h: 0, s: 0, l: 128 / 255 });
  });

  test("muting keeps the hue and lowers saturation", () => {
    const vivid = toHsl("#6aa7ff");
    const calm = toHsl(muteColor("#6aa7ff", { saturation: 0.5, lightness: 1 }));
    expect(calm.h).toBeCloseTo(vivid.h, -1);
    expect(calm.s).toBeCloseTo(vivid.s * 0.5, 1);
    expect(calm.l).toBeCloseTo(vivid.l, 1);
  });

  test("muting a grey changes only its lightness", () => {
    expect(muteColor("#808080", { saturation: 0.3, lightness: 0.5 })).toBe("#404040");
  });

  test("premultiplies channels for sigma", () => {
    expect(withPremultipliedAlpha("#ff8000", 0.5)).toBe("rgba(128, 64, 0, 0.500)");
    expect(withPremultipliedAlpha("#ffffff", 0)).toBe("rgba(0, 0, 0, 0.000)");
    expect(withPremultipliedAlpha("#102030", 4)).toBe("rgba(16, 32, 48, 1.000)");
  });

  test("produces rgba strings with a clamped alpha", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.500)");
    expect(withAlpha("#ff0000", 4)).toBe("rgba(255, 0, 0, 1.000)");
    expect(withAlpha("#ff0000", -1)).toBe("rgba(255, 0, 0, 0.000)");
  });
});
