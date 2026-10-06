/** One run of changed lines between two texts. Line numbers are 1-based. */
export interface LineHunk {
  oldStart: number;
  oldCount: number;
  // First added line; for a pure removal, the line that now follows the removed ones.
  newStart: number;
  newCount: number;
  removed: string[];
  // The same change as a character edit of the old text, for applying it to an open editor.
  edit: TextEdit;
}

export interface TextEdit {
  offset: number;
  length: number;
  text: string;
}

interface Line {
  text: string;
  start: number;
  end: number;
}

interface Run {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

// Past this many changed lines the exact diff is not worth its cost, so the changed span becomes one hunk.
const MAX_EDIT_DISTANCE = 1000;
const LINE_BREAK = /\r\n|\r|\n/g;

/** Lines of a text with their offsets; a final line break does not start another line. */
function toLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    const end = match.index + match[0].length;
    lines.push({ text: text.slice(start, match.index), start, end });
    start = end;
  }
  if (start < text.length) lines.push({ text: text.slice(start), start, end: text.length });
  return lines;
}

/** The one edit, trimmed of what the texts share at both ends, that turns `before` into `after`; null when they are equal. */
export function replacedSpan(before: string, after: string): TextEdit | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < shortest - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  return { offset: start, length: before.length - start - end, text: after.slice(start, after.length - end) };
}

/** The text with every line break replaced by `eol`. */
export function withLineBreaks(text: string, eol: string): string {
  return text.replace(LINE_BREAK, eol);
}

export function countLines(text: string): number {
  return toLines(text).length;
}

/** The hunks that turn `before` into `after`, comparing lines together with their line breaks. */
export function diffLines(before: string, after: string): LineHunk[] {
  if (before === after) return [];
  const oldLines = toLines(before);
  const newLines = toLines(after);
  const oldKeys = oldLines.map((line) => before.slice(line.start, line.end));
  const newKeys = newLines.map((line) => after.slice(line.start, line.end));
  return diffKeys(oldKeys, newKeys).map((run) => toHunk(run, { before, after, oldLines, newLines }));
}

function diffKeys(a: string[], b: string[]): Run[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }
  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);
  const runs = middleRuns(middleA, middleB);
  return runs.map((run) => ({
    oldStart: run.oldStart + prefix + 1,
    oldCount: run.oldCount,
    newStart: run.newStart + prefix + 1,
    newCount: run.newCount,
  }));
}

function middleRuns(a: string[], b: string[]): Run[] {
  if (a.length === 0 && b.length === 0) return [];
  const flags = myers(a, b);
  if (flags === null) return [{ oldStart: 0, oldCount: a.length, newStart: 0, newCount: b.length }];
  return collectRuns(flags.deleted, flags.inserted);
}

interface Sources {
  before: string;
  after: string;
  oldLines: Line[];
  newLines: Line[];
}

// The characters covered by `count` lines from line index `from`; empty, at the place they would start, when there are none.
function spanOf(lines: Line[], from: number, count: number, textLength: number): { start: number; end: number } {
  const start = lines[from]?.start ?? textLength;
  const end = count === 0 ? start : (lines[from + count - 1]?.end ?? textLength);
  return { start, end };
}

function toHunk(run: Run, { before, after, oldLines, newLines }: Sources): LineHunk {
  const oldFrom = run.oldStart - 1;
  const old = spanOf(oldLines, oldFrom, run.oldCount, before.length);
  const added = spanOf(newLines, run.newStart - 1, run.newCount, after.length);
  return {
    ...run,
    removed: oldLines.slice(oldFrom, oldFrom + run.oldCount).map((line) => line.text),
    edit: { offset: old.start, length: old.end - old.start, text: after.slice(added.start, added.end) },
  };
}

function collectRuns(deleted: boolean[], inserted: boolean[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  let j = 0;
  while (i < deleted.length || j < inserted.length) {
    if (i < deleted.length && j < inserted.length && deleted[i] !== true && inserted[j] !== true) {
      i += 1;
      j += 1;
      continue;
    }
    const oldStart = i;
    const newStart = j;
    while (deleted[i] === true) i += 1;
    while (inserted[j] === true) j += 1;
    runs.push({ oldStart, oldCount: i - oldStart, newStart, newCount: j - newStart });
  }
  return runs;
}

interface EditFlags {
  deleted: boolean[];
  inserted: boolean[];
}

/** Myers' shortest edit script, or null when the texts differ by more than the distance limit. */
function myers(a: string[], b: string[]): EditFlags | null {
  const limit = Math.min(a.length + b.length, MAX_EDIT_DISTANCE);
  const offset = limit + 1;
  const frontier = new Int32Array(2 * limit + 3);
  const history: Int32Array[] = [];
  for (let d = 0; d <= limit; d += 1) {
    history.push(frontier.slice());
    if (extendFrontier(frontier, { a, b, d, offset })) return backtrack(history, { a, b, d, offset });
  }
  return null;
}

interface Round {
  a: string[];
  b: string[];
  d: number;
  offset: number;
}

function cell(frontier: Int32Array, index: number): number {
  return frontier[index] ?? 0;
}

// Whether diagonal k of round d continues from k + 1 (an insertion) rather than from k - 1 (a deletion).
function movesDown(frontier: Int32Array, k: number, { d, offset }: Pick<Round, "d" | "offset">): boolean {
  return k === -d || (k !== d && cell(frontier, offset + k - 1) < cell(frontier, offset + k + 1));
}

// Advances every diagonal of round d; true once the end of both inputs has been reached.
function extendFrontier(frontier: Int32Array, round: Round): boolean {
  const { a, b, d, offset } = round;
  for (let k = -d; k <= d; k += 2) {
    let x = movesDown(frontier, k, round) ? cell(frontier, offset + k + 1) : cell(frontier, offset + k - 1) + 1;
    let y = x - k;
    while (x < a.length && y < b.length && a[x] === b[y]) {
      x += 1;
      y += 1;
    }
    frontier[offset + k] = x;
    if (x >= a.length && y >= b.length) return true;
  }
  return false;
}

function backtrack(history: Int32Array[], { a, b, d: last, offset }: Round): EditFlags {
  const deleted: boolean[] = Array.from({ length: a.length }, () => false);
  const inserted: boolean[] = Array.from({ length: b.length }, () => false);
  let x = a.length;
  let y = b.length;
  for (let d = last; d > 0; d -= 1) {
    const previous = history[d];
    if (previous === undefined) break;
    const k = x - y;
    const down = movesDown(previous, k, { d, offset });
    const previousK = down ? k + 1 : k - 1;
    const previousX = cell(previous, offset + previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
    }
    if (down) inserted[previousY] = true;
    else deleted[previousX] = true;
    x = previousX;
    y = previousY;
  }
  return { deleted, inserted };
}
