import { resolve } from "node:path";

import { z } from "zod";

export const MAX_SEARCH_READ_EVENTS = 25;

const CHANGE_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit"]);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(["Grep", "Glob"]);

const filePathInputSchema = z.object({ file_path: z.string().min(1) });
const notebookInputSchema = z.object({ notebook_path: z.string().min(1) });
const searchOutputSchema = z.object({ filenames: z.array(z.string()) });

export type ToolEffect =
  | { kind: "read"; path: string }
  | { kind: "change"; path: string }
  | { kind: "search" }
  | { kind: "other" };

export function classifyTool(name: string, input: unknown, cwd: string): ToolEffect {
  if (name === "Read") return pathEffect("read", filePathOf(input), cwd);
  if (CHANGE_TOOLS.has(name)) return pathEffect("change", filePathOf(input), cwd);
  if (name === "NotebookEdit") return pathEffect("change", notebookPathOf(input), cwd);
  if (SEARCH_TOOLS.has(name)) return { kind: "search" };
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

function pathEffect(kind: "read" | "change", raw: string | null, cwd: string): ToolEffect {
  return raw === null ? { kind: "other" } : { kind, path: resolve(cwd, raw) };
}

function filePathOf(input: unknown): string | null {
  const parsed = filePathInputSchema.safeParse(input);
  return parsed.success ? parsed.data.file_path : null;
}

function notebookPathOf(input: unknown): string | null {
  const parsed = notebookInputSchema.safeParse(input);
  return parsed.success ? parsed.data.notebook_path : null;
}
