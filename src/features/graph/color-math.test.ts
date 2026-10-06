import { describe, expect, test } from "bun:test";

import { clamp01, mixColors, parseHex, withAlpha } from "./color-math";

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

  test("produces rgba strings with a clamped alpha", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.500)");
    expect(withAlpha("#ff0000", 4)).toBe("rgba(255, 0, 0, 1.000)");
    expect(withAlpha("#ff0000", -1)).toBe("rgba(255, 0, 0, 0.000)");
  });
});
