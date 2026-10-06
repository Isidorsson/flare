import { LIVE } from "./timing";
import type { ReadRequest } from "./live-types";

export interface ReadPlan {
  // The lines to light up, ascending.
  lines: number[];
  // The span to bring into view.
  first: number;
  last: number;
  label: string;
}

/** Which lines of a file of `lineCount` lines a read lights up, and what its label says. */
export function planRead(request: ReadRequest, lineCount: number): ReadPlan {
  if (request.matchLines !== null && request.pattern !== null) return planSearch(request.pattern, request.matchLines, lineCount);
  const start = clampLine(request.range?.start ?? 1, lineCount);
  const end = clampLine(request.range?.end ?? lineCount, lineCount);
  const lines = rangeLines(start, Math.min(end, start + LIVE.read.maxHighlightLines - 1));
  return { lines, first: start, last: Math.max(start, end), label: `Claude · reading lines ${String(start)}–${String(end)}` };
}

function planSearch(pattern: string, matchLines: readonly number[], lineCount: number): ReadPlan {
  const inFile = [...new Set(matchLines)].filter((line) => line >= 1 && line <= lineCount).sort((a, b) => a - b);
  const lines = inFile.slice(0, LIVE.read.maxMatchLines);
  const noun = matchLines.length === 1 ? "match" : "matches";
  return {
    lines,
    first: lines[0] ?? 1,
    last: lines.at(-1) ?? 1,
    label: `Claude · searching "${pattern}" · ${String(matchLines.length)} ${noun}`,
  };
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(1, Math.min(line, Math.max(lineCount, 1)));
}

function rangeLines(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

export type ScrollMode = "center" | "top";

/** Centre a span that fits in the view, otherwise put its first line near the top. */
export function scrollMode(first: number, last: number, visibleLines: number): ScrollMode {
  return last - first + 1 <= visibleLines ? "center" : "top";
}
