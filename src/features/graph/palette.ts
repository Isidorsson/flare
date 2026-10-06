import { mixColors, muteColor, parseHex, type MuteOptions } from "./color-math";
import { LANGUAGES, type Language } from "./graph-types";
import { ROLES, type Role } from "./roles";

export const LANGUAGE_TOKENS = {
  typescript: "--color-info",
  javascript: "--color-warning",
  rust: "--color-danger",
  python: "--color-success",
  lua: "--color-lang-lua",
  luau: "--color-lang-luau",
  go: "--color-lang-go",
  c: "--color-lang-c",
  cpp: "--color-lang-cpp",
  csharp: "--color-lang-csharp",
  java: "--color-lang-java",
  kotlin: "--color-lang-kotlin",
  ruby: "--color-lang-ruby",
  php: "--color-lang-php",
  swift: "--color-lang-swift",
  dart: "--color-lang-dart",
  zig: "--color-lang-zig",
  shell: "--color-lang-shell",
  css: "--color-lang-css",
  vue: "--color-lang-vue",
  svelte: "--color-lang-svelte",
} as const satisfies Record<Language, string>;

export const ROLE_TOKENS = {
  frontend: "--color-info",
  database: "--color-lang-go",
  config: "--color-fg-subtle",
  code: "--color-fg-muted",
  api: "--color-lang-luau",
  tests: "--color-lang-shell",
  docs: "--color-lang-css",
  assets: "--color-lang-java",
} as const satisfies Record<Role, string>;

export const FOLDER_TOKENS = [
  "--color-info",
  "--color-success",
  "--color-warning",
  "--color-lang-luau",
  "--color-lang-go",
  "--color-lang-css",
  "--color-lang-java",
  "--color-lang-lua",
] as const;

export const BLAST_ORIGIN_TOKEN = "--color-accent";
/** How far each further hop of dependents fades from the importer colour towards the background. */
export const BLAST_FADE_PER_HOP = [0, 0.3, 0.55] as const;

const SURFACE_TOKENS = {
  dim: "--color-border-strong",
  edge: "--color-fg-subtle",
  edgeActive: "--color-fg-muted",
  label: "--color-fg-muted",
  labelDim: "--color-fg-subtle",
  labelStrong: "--color-fg",
  panel: "--color-surface-2",
  background: "--color-bg",
  explore: "--color-activity-read",
  importer: "--color-lang-luau",
  imports: "--color-info",
} as const;

const FONT_TOKEN = "--font-sans";
const MONO_FONT_TOKEN = "--font-mono";

/** Node fills sit well below the vivid tokens so that only the agent's own colours stand out. */
export const NODE_MUTE: MuteOptions = { saturation: 0.58, lightness: 0.94 };

export interface Palette {
  /** Node fills per language, muted. */
  language: Readonly<Record<Language, string>>;
  /** Node fills per role, muted. */
  roles: Readonly<Record<Role, string>>;
  /** The unmuted role colours, for soft area glows. */
  roleHues: Readonly<Record<Role, string>>;
  directories: readonly string[];
  blastOrigin: string;
  blastDepths: readonly string[];
  dim: string;
  edge: string;
  edgeActive: string;
  label: string;
  labelDim: string;
  labelStrong: string;
  panel: string;
  background: string;
  explore: string;
  importer: string;
  imports: string;
  fontFamily: string;
  monoFamily: string;
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

function font(read: ReadToken, name: string): string {
  const value = read(name).trim();
  if (value === "") throw new Error(`design token ${name} is not defined`);
  return value;
}

function languageColors(pick: (token: string) => string): Record<Language, string> {
  const colors: Record<Language, string> = { ...LANGUAGE_TOKENS };
  for (const language of LANGUAGES) {
    colors[language] = muteColor(pick(LANGUAGE_TOKENS[language]), NODE_MUTE);
  }
  return colors;
}

function roleColors(pick: (token: string) => string, mute: boolean): Record<Role, string> {
  const colors: Record<Role, string> = { ...ROLE_TOKENS };
  for (const role of ROLES) {
    const raw = pick(ROLE_TOKENS[role]);
    colors[role] = mute ? muteColor(raw, NODE_MUTE) : raw;
  }
  return colors;
}

export function readPalette(read: ReadToken): Palette {
  const pick = (name: string) => color(read, name);
  const importer = pick(SURFACE_TOKENS.importer);
  const background = pick(SURFACE_TOKENS.background);
  return {
    language: languageColors(pick),
    roles: roleColors(pick, true),
    roleHues: roleColors(pick, false),
    directories: FOLDER_TOKENS.map((token) => muteColor(pick(token), NODE_MUTE)),
    blastOrigin: pick(BLAST_ORIGIN_TOKEN),
    blastDepths: BLAST_FADE_PER_HOP.map((fade) => mixColors(importer, background, fade)),
    dim: pick(SURFACE_TOKENS.dim),
    edge: pick(SURFACE_TOKENS.edge),
    edgeActive: pick(SURFACE_TOKENS.edgeActive),
    label: pick(SURFACE_TOKENS.label),
    labelDim: pick(SURFACE_TOKENS.labelDim),
    labelStrong: pick(SURFACE_TOKENS.labelStrong),
    panel: pick(SURFACE_TOKENS.panel),
    background,
    explore: pick(SURFACE_TOKENS.explore),
    importer,
    imports: pick(SURFACE_TOKENS.imports),
    fontFamily: font(read, FONT_TOKEN),
    monoFamily: font(read, MONO_FONT_TOKEN),
  };
}

export const ALL_PALETTE_TOKENS: readonly string[] = [
  ...Object.values(LANGUAGE_TOKENS),
  ...Object.values(ROLE_TOKENS),
  ...FOLDER_TOKENS,
  BLAST_ORIGIN_TOKEN,
  ...Object.values(SURFACE_TOKENS),
  FONT_TOKEN,
  MONO_FONT_TOKEN,
];
