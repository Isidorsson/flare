import { describe, expect, test } from "bun:test";

import { fixturePalette, readTokenFromCss } from "./palette-fixture";
import {
  ALL_PALETTE_TOKENS,
  BLAST_FADE_PER_HOP,
  FOLDER_TOKENS,
  LANGUAGE_TOKENS,
  NODE_MUTE,
  readPalette,
  ROLE_TOKENS,
} from "./palette";
import { muteColor, parseHex, toHsl } from "./color-math";
import { ROLES } from "./roles";
import { LANGUAGES } from "./graph-types";

const MIN_CONTRAST_ON_BACKGROUND = 4.5;
const MIN_COLOUR_DISTANCE = 4;
const MIN_ROLE_DISTANCE = 6;
const MIN_GRAPHIC_CONTRAST = 3;

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function oklab(hex: string): readonly [number, number, number] {
  const { r, g, b } = parseHex(hex);
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function colourDistance(a: string, b: string): number {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe("palette", () => {
  test("every referenced token is defined in tokens.css", () => {
    for (const token of ALL_PALETTE_TOKENS) {
      expect(readTokenFromCss(token).trim(), token).not.toBe("");
    }
  });

  test("resolves every colour from the stylesheet without hard-coded values", () => {
    const palette = fixturePalette();
    for (const language of LANGUAGES) {
      expect(palette.language[language]).toBe(muteColor(readTokenFromCss(LANGUAGE_TOKENS[language]).trim(), NODE_MUTE));
    }
    for (const role of ROLES) {
      expect(palette.roleHues[role]).toBe(readTokenFromCss(ROLE_TOKENS[role]).trim());
    }
    expect(palette.directories).toHaveLength(FOLDER_TOKENS.length);
    expect(palette.blastDepths).toHaveLength(BLAST_FADE_PER_HOP.length);
    expect(palette.fontFamily).toContain("Segoe UI");
    expect(palette.monoFamily).toContain("Cascadia");
  });

  test("builds the palette only from Flare tokens that already exist", () => {
    for (const token of ALL_PALETTE_TOKENS) {
      expect(token).toMatch(/^--(color|font)-(bg|surface|border|fg|accent|success|warning|danger|info|activity|agent|lang|sans|mono)/);
    }
  });

  test("gives every language its own colour", () => {
    const colours = new Set(Object.values(fixturePalette().language));
    expect(colours.size).toBe(LANGUAGES.length);
  });

  test("mutes node colours: less saturated than the token, never brighter", () => {
    const palette = fixturePalette();
    for (const language of LANGUAGES) {
      const raw = toHsl(readTokenFromCss(LANGUAGE_TOKENS[language]).trim());
      const calm = toHsl(palette.language[language]);
      expect(calm.s, language).toBeLessThanOrEqual(raw.s);
      expect(calm.l, language).toBeLessThanOrEqual(raw.l + 0.01);
    }
  });

  test("keeps every node colour legible on the graph background", () => {
    const palette = fixturePalette();
    for (const language of LANGUAGES) {
      expect(contrast(palette.language[language], palette.background), language).toBeGreaterThanOrEqual(
        MIN_CONTRAST_ON_BACKGROUND,
      );
    }
    for (const role of ROLES) {
      expect(contrast(palette.roles[role], palette.background), role).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST);
    }
  });

  test("keeps every pair of language colours distinguishable", () => {
    const { language } = fixturePalette();
    for (const [index, first] of LANGUAGES.entries()) {
      for (const second of LANGUAGES.slice(index + 1)) {
        expect(colourDistance(language[first], language[second]), `${first} vs ${second}`).toBeGreaterThanOrEqual(
          MIN_COLOUR_DISTANCE,
        );
      }
    }
  });

  test("keeps every pair of role colours distinguishable", () => {
    const { roles } = fixturePalette();
    for (const [index, first] of ROLES.entries()) {
      for (const second of ROLES.slice(index + 1)) {
        expect(colourDistance(roles[first], roles[second]), `${first} vs ${second}`).toBeGreaterThanOrEqual(MIN_ROLE_DISTANCE);
      }
    }
  });

  test("fades blast depths towards the background", () => {
    const { blastDepths, background } = fixturePalette();
    const [first, second, third] = blastDepths;
    if (first === undefined || second === undefined || third === undefined) throw new Error("missing blast depths");
    expect(colourDistance(first, background)).toBeGreaterThan(colourDistance(second, background));
    expect(colourDistance(second, background)).toBeGreaterThan(colourDistance(third, background));
  });

  test("fails fast on a missing token", () => {
    expect(() => readPalette(() => "")).toThrow("is not defined");
  });

  test("fails fast on a colour that is not a hex value", () => {
    expect(() => readPalette((name) => (name === "--font-sans" ? "sans-serif" : "rebeccapurple"))).toThrow();
  });
});
