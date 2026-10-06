import { describe, expect, test } from "bun:test";

import { fixturePalette, readTokenFromCss } from "./palette-fixture";
import {
  ALL_PALETTE_TOKENS,
  BLAST_TOKENS,
  DIRECTORY_TOKENS,
  LANGUAGE_TOKENS,
  readPalette,
} from "./palette";
import { LANGUAGES } from "./graph-types";

describe("palette", () => {
  test("every referenced token is defined in tokens.css", () => {
    for (const token of ALL_PALETTE_TOKENS) {
      expect(readTokenFromCss(token).trim(), token).not.toBe("");
    }
  });

  test("resolves every colour from the stylesheet without hard-coded values", () => {
    const palette = fixturePalette();
    for (const language of LANGUAGES) {
      expect(palette.language[language]).toBe(readTokenFromCss(LANGUAGE_TOKENS[language]).trim());
    }
    expect(palette.directories).toHaveLength(DIRECTORY_TOKENS.length);
    expect(palette.blastDepths).toHaveLength(BLAST_TOKENS.depths.length);
    expect(palette.fontFamily).toContain("Segoe UI");
  });

  test("gives every language its own colour", () => {
    const colours = new Set(Object.values(fixturePalette().language));
    expect(colours.size).toBe(LANGUAGES.length);
  });

  test("fails fast on a missing token", () => {
    expect(() => readPalette(() => "")).toThrow("is not defined");
  });

  test("fails fast on a colour that is not a hex value", () => {
    expect(() => readPalette((name) => (name === "--font-sans" ? "sans-serif" : "rebeccapurple"))).toThrow();
  });
});
