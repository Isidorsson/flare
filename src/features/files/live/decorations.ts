import type { editor } from "monaco-editor";

import type { EditStep } from "./edit-steps";
import type { ReadPlan } from "./read-plan";
import { LIVE } from "./timing";
import type { TurnMarks } from "./turn-summary";
import type { Position } from "./typing-preview";

export type Decoration = editor.IModelDeltaDecoration;

export interface Ruler {
  color: string;
  lane: editor.OverviewRulerLane;
}

export interface LineInfo {
  lineCount: number;
  maxColumn: (line: number) => number;
}

function lineRange(line: number, endColumn = 1) {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn };
}

/** Class names that delay an animation by `index` steps: one class for the ones digit, one for the tens. */
export function staggerClasses(index: number, maxIndex: number): string {
  const clamped = Math.max(0, Math.min(index, maxIndex));
  return `flare-su${String(clamped % 10)} flare-st${String(Math.floor(clamped / 10))}`;
}

/** A pulsing cyan wave over the lines a read covers, each line a little behind the one above. */
export function readDecorations(plan: ReadPlan): Decoration[] {
  const lastIndex = LIVE.read.maxHighlightLines - 1;
  return plan.lines.map((line, index) => ({
    range: lineRange(line),
    options: {
      isWholeLine: true,
      className: `flare-wave ${staggerClasses(index, lastIndex)}`,
      linesDecorationsClassName: "flare-bar flare-bar-read",
    },
  }));
}

export interface AddedOptions {
  // The edit was typed out on screen already, so its lines appear at once and the text does not fade in again.
  settled: boolean;
}

function addedLines(step: EditStep, lineCount: number): number[] {
  const lines: number[] = [];
  for (const hunk of step.hunks) {
    for (let line = hunk.newStart; line < hunk.newStart + hunk.newCount; line += 1) {
      if (line >= 1 && line <= lineCount) lines.push(line);
    }
  }
  return lines;
}

/** Green lines sweeping in left to right, the text fading in from a blur a line at a time. */
export function addedDecorations(step: EditStep, info: LineInfo, { settled }: AddedOptions): Decoration[] {
  return addedLines(step, info.lineCount).map((line, index) => {
    const delay = settled ? "" : ` ${staggerClasses(index, LIVE.edit.maxStaggerLines - 1)}`;
    const maxColumn = info.maxColumn(line);
    return {
      range: lineRange(line, maxColumn),
      options: {
        isWholeLine: true,
        className: settled ? "flare-add flare-add-settled" : `flare-add${delay}`,
        linesDecorationsClassName: `flare-bar flare-bar-add flare-fade-out${settled ? " flare-fade-out-settled" : ""}`,
        ...(maxColumn > 1 && !settled ? { inlineClassName: `flare-add-text${delay}` } : {}),
      },
    };
  });
}

/** Where a step ends up: the line at the end of its last added line, for the collaborator caret. */
export function caretAfterStep(step: EditStep, info: LineInfo): Position | null {
  const lines = addedLines(step, info.lineCount);
  const last = lines.at(-1);
  return last === undefined ? null : { line: last, column: info.maxColumn(last) };
}

/** A thin green bar on every line the turn added, a small red marker where it removed lines, and green ticks in the ruler. */
export function markDecorations(marks: TurnMarks, info: LineInfo, ruler: Ruler): Decoration[] {
  const added: Decoration[] = marks.added
    .map((span) => ({ start: Math.max(1, span.start), end: Math.min(span.end, info.lineCount) }))
    .filter((span) => span.start <= span.end)
    .map((span) => ({
      range: { startLineNumber: span.start, startColumn: 1, endLineNumber: span.end, endColumn: 1 },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: "flare-mark flare-mark-add",
        overviewRuler: { color: ruler.color, position: ruler.lane },
      },
    }));
  const removed: Decoration[] = marks.removedAt.filter((line) => line >= 1).map((line) => {
    const atEnd = line > info.lineCount;
    return {
      range: lineRange(atEnd ? Math.max(1, info.lineCount) : line),
      options: { linesDecorationsClassName: `flare-mark flare-mark-removed${atEnd ? " flare-mark-removed-end" : ""}` },
    };
  });
  return [...added, ...removed];
}

/** The lines the model is typing into: tinted, with the typed characters a little brighter. */
export function typingDecorations(start: Position, end: Position): Decoration[] {
  const lines: Decoration = {
    range: { startLineNumber: start.line, startColumn: 1, endLineNumber: end.line, endColumn: 1 },
    options: { isWholeLine: true, className: "flare-typing-line", linesDecorationsClassName: "flare-bar flare-bar-add" },
  };
  const hasText = start.line !== end.line || start.column !== end.column;
  if (!hasText) return [lines];
  const typed: Decoration = {
    range: { startLineNumber: start.line, startColumn: start.column, endLineNumber: end.line, endColumn: end.column },
    options: { inlineClassName: "flare-typed-text" },
  };
  return [lines, typed];
}
