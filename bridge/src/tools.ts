import { resolve } from "node:path";

import { MAX_MATCH_LINES, type LineRange } from "@flare/protocol";
import { z } from "zod";

export const MAX_SEARCH_READ_EVENTS = 25;
// How many lines the Read tool returns when the model gives no limit.
export const DEFAULT_READ_LINE_LIMIT = 2000;

const CHANGE_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit"]);

const filePathInputSchema = z.object({ file_path: z.string().min(1) });
const readInputSchema = z.object({
  file_path: z.string().min(1),
  offset: z.number().int().nonnegative().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
});
const notebookInputSchema = z.object({ notebook_path: z.string().min(1) });
const grepInputSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional().catch(undefined),
  output_mode: z.string().optional().catch(undefined),
});
const searchOutputSchema = z.object({ filenames: z.array(z.string()) });
const grepContentOutputSchema = z.object({ mode: z.literal("content"), content: z.string() });

export type SearchTool = "Grep" | "Glob";

export type ToolEffect =
  | { kind: "read"; path: string; range: LineRange }
  | { kind: "change"; path: string }
  | { kind: "search"; tool: SearchTool; pattern: string | null; target: string | null; contentMode: boolean }
  | { kind: "other" };

export interface SearchMatches {
  pattern: string;
  path: string;
  matchLines: number[];
}

export function classifyTool(name: string, input: unknown, cwd: string): ToolEffect {
  if (name === "Read") return readEffect(input, cwd);
  if (CHANGE_TOOLS.has(name)) return pathEffect(filePathOf(input), cwd);
  if (name === "NotebookEdit") return pathEffect(notebookPathOf(input), cwd);
  if (name === "Grep") return grepEffect(input, cwd);
  if (name === "Glob") return { kind: "search", tool: "Glob", pattern: null, target: null, contentMode: false };
  return { kind: "other" };
}

export function searchResultPaths(structuredResult: unknown, cwd: string): string[] {
  // CLIs that predate the structured result only provide the text summary, so there is nothing to pulse.
  const parsed = searchOutputSchema.safeParse(structuredResult);
  if (!parsed.success) return [];
  return parsed.data.filenames
    .filter((name) => name.length > 0)
    .slice(0, MAX_SEARCH_READ_EVENTS)
    .map((name) => resolve(cwd, name));
}

/**
 * The lines a Grep in content mode matched when it searched one file. A
 * search over a directory prefixes every line with its file name, which is how
 * the two are told apart.
 */
export function singleFileMatches(effect: ToolEffect, structuredResult: unknown): SearchMatches | null {
  if (effect.kind !== "search" || !effect.contentMode) return null;
  if (effect.pattern === null || effect.target === null) return null;
  const parsed = grepContentOutputSchema.safeParse(structuredResult);
  if (!parsed.success) return null;
  const matchLines = singleFileMatchLines(parsed.data.content);
  return matchLines === null ? null : { pattern: effect.pattern, path: effect.target, matchLines };
}

const NUMBERED_LINE = /^(\d+)([:-])/;

function singleFileMatchLines(content: string): number[] | null {
  const lines = new Set<number>();
  for (const line of content.split("\n")) {
    if (line === "" || line === "--") continue;
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered === null) return null;
    if (numbered[2] === ":") lines.add(Number(numbered[1]));
  }
  if (lines.size === 0) return null;
  return [...lines]
    .filter((line) => line > 0)
    .sort((a, b) => a - b)
    .slice(0, MAX_MATCH_LINES);
}

function readEffect(input: unknown, cwd: string): ToolEffect {
  const parsed = readInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "other" };
  const start = Math.max(1, parsed.data.offset ?? 1);
  const end = start + (parsed.data.limit ?? DEFAULT_READ_LINE_LIMIT) - 1;
  return { kind: "read", path: resolve(cwd, parsed.data.file_path), range: { start, end } };
}

function grepEffect(input: unknown, cwd: string): ToolEffect {
  const parsed = grepInputSchema.safeParse(input);
  if (!parsed.success) return { kind: "search", tool: "Grep", pattern: null, target: null, contentMode: false };
  const { pattern, path, output_mode: mode } = parsed.data;
  return {
    kind: "search",
    tool: "Grep",
    pattern,
    target: path === undefined ? null : resolve(cwd, path),
    contentMode: mode === "content",
  };
}

function pathEffect(raw: string | null, cwd: string): ToolEffect {
  return raw === null ? { kind: "other" } : { kind: "change", path: resolve(cwd, raw) };
}

function filePathOf(input: unknown): string | null {
  const parsed = filePathInputSchema.safeParse(input);
  return parsed.success ? parsed.data.file_path : null;
}

function notebookPathOf(input: unknown): string | null {
  const parsed = notebookInputSchema.safeParse(input);
  return parsed.success ? parsed.data.notebook_path : null;
}
