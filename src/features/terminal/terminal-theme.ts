import type { ITheme } from "ghostty-web";
import { z } from "zod";

import { TERMINAL_FONT_SIZE, TERMINAL_SCROLLBACK_LINES } from "./terminal-constants";

export const TERMINAL_TOKEN_VARS = {
  bg: "--color-bg",
  fg: "--color-fg",
  fgMuted: "--color-fg-muted",
  fgSubtle: "--color-fg-subtle",
  surface: "--color-surface-3",
  accent: "--color-accent",
  success: "--color-success",
  warning: "--color-warning",
  danger: "--color-danger",
  info: "--color-info",
} as const;

export const MONO_FONT_VAR = "--font-mono";

const SELECTION_ACCENT_WEIGHT = 0.35;
const BRIGHT_WEIGHT = 0.25;
const BLEND_HALF = 0.5;

type TokenName = keyof typeof TERMINAL_TOKEN_VARS;
export type TerminalTokens = Record<TokenName, string>;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface TerminalAppearance {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
}

const hexColorSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

export function parseHexColor(value: string): Rgb {
  const parsed = hexColorSchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new Error(`Terminal theme token must be a #rgb or #rrggbb colour, got "${value}"`);
  }
  const digits = parsed.data.slice(1);
  const full = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function mixColors(base: Rgb, other: Rgb, weightOfOther: number): Rgb {
  const blend = (from: number, to: number) => Math.round(from + (to - from) * weightOfOther);
  return { r: blend(base.r, other.r), g: blend(base.g, other.g), b: blend(base.b, other.b) };
}

function readRequired(readVar: (name: string) => string, name: string): string {
  const value = readVar(name).trim();
  if (value === "") throw new Error(`Missing CSS custom property ${name}`);
  return value;
}

export function readTerminalTokens(readVar: (name: string) => string): TerminalTokens {
  const read = (token: TokenName) => readRequired(readVar, TERMINAL_TOKEN_VARS[token]);
  return {
    bg: read("bg"),
    fg: read("fg"),
    fgMuted: read("fgMuted"),
    fgSubtle: read("fgSubtle"),
    surface: read("surface"),
    accent: read("accent"),
    success: read("success"),
    warning: read("warning"),
    danger: read("danger"),
    info: read("info"),
  };
}

export function buildTerminalTheme(tokens: TerminalTokens): ITheme {
  const color = (token: TokenName) => parseHexColor(tokens[token]);
  const [bg, fg, accent] = [color("bg"), color("fg"), color("accent")];
  const [red, green, yellow, blue] = [color("danger"), color("success"), color("warning"), color("info")];
  const magenta = mixColors(blue, red, BLEND_HALF);
  const cyan = mixColors(blue, green, BLEND_HALF);
  const brighten = (base: Rgb) => toHex(mixColors(base, fg, BRIGHT_WEIGHT));

  return {
    background: toHex(bg),
    foreground: toHex(fg),
    cursor: toHex(accent),
    cursorAccent: toHex(bg),
    selectionBackground: toHex(mixColors(bg, accent, SELECTION_ACCENT_WEIGHT)),
    selectionForeground: toHex(fg),
    black: toHex(color("surface")),
    red: toHex(red),
    green: toHex(green),
    yellow: toHex(yellow),
    blue: toHex(blue),
    magenta: toHex(magenta),
    cyan: toHex(cyan),
    white: toHex(color("fgMuted")),
    brightBlack: toHex(color("fgSubtle")),
    brightRed: brighten(red),
    brightGreen: brighten(green),
    brightYellow: brighten(yellow),
    brightBlue: brighten(blue),
    brightMagenta: brighten(magenta),
    brightCyan: brighten(cyan),
    brightWhite: toHex(fg),
  };
}

export function readTerminalAppearance(root: Element): TerminalAppearance {
  const style = getComputedStyle(root);
  const readVar = (name: string) => style.getPropertyValue(name);
  return {
    theme: buildTerminalTheme(readTerminalTokens(readVar)),
    fontFamily: readRequired(readVar, MONO_FONT_VAR),
    fontSize: TERMINAL_FONT_SIZE,
    scrollback: TERMINAL_SCROLLBACK_LINES,
  };
}
