import { LIVE } from "./timing";
import type { TypingEdit } from "./live-types";

export interface Position {
  line: number;
  column: number;
}

/** A file with the text the model is typing already in place. */
export interface TypingView {
  content: string;
  typedStart: Position;
  typedEnd: Position;
  // The lines the typed text replaces, shown struck through above it.
  replaced: string[];
}

const LINE_BREAK = /\r\n|\r|\n/g;

/** The 1-based line and column of a character offset. */
export function positionAt(text: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  for (const match of text.slice(0, offset).matchAll(LINE_BREAK)) {
    line += 1;
    lineStart = match.index + match[0].length;
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Puts what the model has typed so far into the file. Null when an edit's old
 * text cannot be found in the file, so the text has nowhere to go.
 */
export function previewTyping(content: string, edit: TypingEdit): TypingView | null {
  if (edit.kind === "write") return placed("", edit.text, "", []);
  const { oldString } = edit;
  if (oldString === null || oldString === "") return null;
  const at = content.indexOf(oldString);
  if (at < 0) return null;
  return placed(content.slice(0, at), edit.text, content.slice(at + oldString.length), oldString.split(LINE_BREAK));
}

function placed(before: string, typed: string, after: string, replaced: string[]): TypingView {
  return {
    content: before + typed + after,
    typedStart: positionAt(before + typed, before.length),
    typedEnd: positionAt(before + typed, before.length + typed.length),
    replaced,
  };
}

export function typingLabel(view: TypingView, { created, kind }: { created: boolean; kind: TypingEdit["kind"] }): string {
  if (created) return "Claude · writing a new file";
  const { typedStart, typedEnd } = view;
  const span =
    typedStart.line === typedEnd.line
      ? `line ${String(typedStart.line)}`
      : `lines ${String(typedStart.line)}–${String(typedEnd.line)}`;
  return `Claude · ${kind === "write" ? "writing" : "editing"} ${span}`;
}

/** The removed lines to show above typed text, and how many were left out. */
export function phantomLines(removed: readonly string[]): { shown: string[]; hidden: number } {
  const limit = LIVE.edit.maxPhantomLines;
  return { shown: removed.slice(0, limit), hidden: Math.max(0, removed.length - limit) };
}
