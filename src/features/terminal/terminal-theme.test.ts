import { describe, expect, test } from "bun:test";

import {
  MONO_FONT_VAR,
  TERMINAL_TOKEN_VARS,
  buildTerminalTheme,
  mixColors,
  parseHexColor,
  readTerminalTokens,
  toHex,
  type TerminalTokens,
} from "./terminal-theme";

const tokensCss = await Bun.file(new URL("../../styles/tokens.css", import.meta.url)).text();

function declaredTokens(css: string): Map<string, string> {
  const declarations = css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
  return new Map(Array.from(declarations, ([, name, value]) => [name ?? "", (value ?? "").trim()]));
}

const declared = declaredTokens(tokensCss);
const readFromTokensCss = (name: string) => declared.get(name) ?? "";

describe("hex colours", () => {
  test("parses long and short forms, any case", () => {
    expect(parseHexColor("#0b0c0f")).toEqual({ r: 11, g: 12, b: 15 });
    expect(parseHexColor("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("  #1f2127 ")).toEqual({ r: 31, g: 33, b: 39 });
  });

  test("rejects other colour syntaxes", () => {
    for (const bad of ["", "red", "#12", "#12345", "#gggggg", "rgb(1, 2, 3)", "oklch(0.5 0.1 20)"]) {
      expect(() => parseHexColor(bad)).toThrow("#rgb or #rrggbb");
    }
  });

  test("round-trips through toHex", () => {
    expect(toHex(parseHexColor("#0b0c0f"))).toBe("#0b0c0f");
    expect(toHex({ r: 0, g: 255, b: 16 })).toBe("#00ff10");
  });

  test("mixes by weight and clamps to the endpoints", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };

    expect(mixColors(black, white, 0)).toEqual(black);
    expect(mixColors(black, white, 1)).toEqual(white);
    expect(mixColors(black, white, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe("terminal tokens", () => {
  test("every mapped CSS variable exists in tokens.css as a hex colour", () => {
    for (const cssVar of Object.values(TERMINAL_TOKEN_VARS)) {
      expect(declared.has(cssVar)).toBe(true);
      expect(() => parseHexColor(readFromTokensCss(cssVar))).not.toThrow();
    }
    expect(declared.has(MONO_FONT_VAR)).toBe(true);
  });

  test("reads each token through its CSS variable", () => {
    const tokens = readTerminalTokens(readFromTokensCss);

    expect(tokens.bg).toBe(declared.get("--color-bg") ?? "");
    expect(tokens.danger).toBe(declared.get("--color-danger") ?? "");
  });

  test("fails fast on a missing variable", () => {
    expect(() => readTerminalTokens(() => "  ")).toThrow("Missing CSS custom property --color-bg");
  });
});

describe("terminal theme", () => {
  const tokens: TerminalTokens = readTerminalTokens(readFromTokensCss);
  const theme = buildTerminalTheme(tokens);

  test("uses the surface and text tokens directly", () => {
    expect(theme.background).toBe(tokens.bg);
    expect(theme.foreground).toBe(tokens.fg);
    expect(theme.cursor).toBe(tokens.accent);
    expect(theme.cursorAccent).toBe(tokens.bg);
    expect(theme.brightWhite).toBe(tokens.fg);
    expect(theme.white).toBe(tokens.fgMuted);
    expect(theme.brightBlack).toBe(tokens.fgSubtle);
  });

  test("maps the semantic tokens onto the ANSI colours", () => {
    expect(theme.red).toBe(tokens.danger);
    expect(theme.green).toBe(tokens.success);
    expect(theme.yellow).toBe(tokens.warning);
    expect(theme.blue).toBe(tokens.info);
  });

  test("derives magenta and cyan between their neighbours", () => {
    const blue = parseHexColor(tokens.info);
    const red = parseHexColor(tokens.danger);
    const green = parseHexColor(tokens.success);

    expect(theme.magenta).toBe(toHex(mixColors(blue, red, 0.5)));
    expect(theme.cyan).toBe(toHex(mixColors(blue, green, 0.5)));
  });

  test("brightens colours toward the foreground", () => {
    const fg = parseHexColor(tokens.fg);
    const red = parseHexColor(tokens.danger);

    expect(theme.brightRed).toBe(toHex(mixColors(red, fg, 0.25)));
  });

  test("emits only colours the terminal's parser understands", () => {
    for (const value of Object.values(theme)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("accepts shorthand tokens and normalises them", () => {
    const shorthand = buildTerminalTheme({ ...tokens, bg: "#000", fg: "#FFF" });

    expect(shorthand.background).toBe("#000000");
    expect(shorthand.foreground).toBe("#ffffff");
  });

  test("rejects a token that is not a hex colour", () => {
    expect(() => buildTerminalTheme({ ...tokens, accent: "oklch(0.7 0.2 40)" })).toThrow("#rgb or #rrggbb");
  });
});
