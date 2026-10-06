import { parseHex } from "./color-math";
import type { Language } from "./graph-types";

export const LANGUAGE_TOKENS = {
  typescript: "--color-info",
  javascript: "--color-warning",
  rust: "--color-danger",
  python: "--color-success",
} as const satisfies Record<Language, string>;

export const DIRECTORY_TOKENS = [
  "--color-accent",
  "--color-info",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--color-fg-muted",
] as const;

export const PULSE_TOKENS = {
  read: "--color-fg",
  change: "--color-accent-hover",
} as const;

export const BLAST_TOKENS = {
  origin: "--color-accent",
  depths: ["--color-danger", "--color-warning", "--color-info"],
} as const;

const SURFACE_TOKENS = {
  dim: "--color-border-strong",
  edge: "--color-border-strong",
  edgeActive: "--color-fg-muted",
  label: "--color-fg-muted",
  labelStrong: "--color-fg",
  panel: "--color-surface-3",
  background: "--color-bg",
} as const;

const FONT_TOKEN = "--font-sans";

export interface Palette {
  language: Readonly<Record<Language, string>>;
  directories: readonly string[];
  pulse: Readonly<Record<keyof typeof PULSE_TOKENS, string>>;
  blastOrigin: string;
  blastDepths: readonly string[];
  dim: string;
  edge: string;
  edgeActive: string;
  label: string;
  labelStrong: string;
  panel: string;
  background: string;
  fontFamily: string;
}

export type ReadToken = (name: string) => string;

export function readCssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

function color(read: ReadToken, name: string): string {
  const value = read(name).trim();
  if (value === "") {
    throw new Error(`design token ${name} is not defined`);
  }
  parseHex(value);
  return value;
}

export function readPalette(read: ReadToken): Palette {
  const pick = (name: string) => color(read, name);
  const font = read(FONT_TOKEN).trim();
  if (font === "") {
    throw new Error(`design token ${FONT_TOKEN} is not defined`);
  }
  return {
    language: {
      typescript: pick(LANGUAGE_TOKENS.typescript),
      javascript: pick(LANGUAGE_TOKENS.javascript),
      rust: pick(LANGUAGE_TOKENS.rust),
      python: pick(LANGUAGE_TOKENS.python),
    },
    directories: DIRECTORY_TOKENS.map(pick),
    pulse: { read: pick(PULSE_TOKENS.read), change: pick(PULSE_TOKENS.change) },
    blastOrigin: pick(BLAST_TOKENS.origin),
    blastDepths: BLAST_TOKENS.depths.map(pick),
    dim: pick(SURFACE_TOKENS.dim),
    edge: pick(SURFACE_TOKENS.edge),
    edgeActive: pick(SURFACE_TOKENS.edgeActive),
    label: pick(SURFACE_TOKENS.label),
    labelStrong: pick(SURFACE_TOKENS.labelStrong),
    panel: pick(SURFACE_TOKENS.panel),
    background: pick(SURFACE_TOKENS.background),
    fontFamily: font,
  };
}

export const ALL_PALETTE_TOKENS: readonly string[] = [
  ...Object.values(LANGUAGE_TOKENS),
  ...DIRECTORY_TOKENS,
  ...Object.values(PULSE_TOKENS),
  BLAST_TOKENS.origin,
  ...BLAST_TOKENS.depths,
  ...Object.values(SURFACE_TOKENS),
  FONT_TOKEN,
];
