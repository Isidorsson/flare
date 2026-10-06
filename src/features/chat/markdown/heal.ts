// While a reply streams, its last line is usually half written. These repairs only change what the parser sees
// of the unfinished tail, so the text on screen settles into its final shape without jumping.

const FENCE = /^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(`{3,}|~{3,})/;
const PARTIAL_FENCE = /^[\s>]*(?:`{1,2}|~{1,2})$/;
const PIPE_ROW = /^\s*\|.*\|\s*$/;
const PARTIAL_DELIMITER_ROW = /^[\s|:-]*$/;
const INLINE_MARKER = /\\[\s\S]|(`+)|(\*+)|(~+)/g;
const PARTIAL_LINK_DESTINATION = /!?\[[^\]\n]*\]\([^)\n]*$/;

interface OpenFence {
  marker: string;
  length: number;
}

function closesFence(line: string, run: string, open: OpenFence): boolean {
  const rest = line.slice(line.indexOf(run) + run.length);
  return run.startsWith(open.marker) && run.length >= open.length && rest.trim() === "";
}

function hasOpenFence(lines: readonly string[]): boolean {
  let open: OpenFence | null = null;
  for (const line of lines) {
    const run = FENCE.exec(line)?.[1];
    if (run === undefined) continue;
    if (open === null) open = { marker: run.charAt(0), length: run.length };
    else if (closesFence(line, run, open)) open = null;
  }
  return open !== null;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function cellCount(row: string): number {
  return row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
}

function delimiterRowFor(headerRow: string): string {
  return `| ${Array.from({ length: cellCount(headerRow) }, () => "---").join(" | ")} |`;
}

function isDelimiterRowFor(row: string, headerRow: string): boolean {
  return PIPE_ROW.test(row) && PARTIAL_DELIMITER_ROW.test(row) && cellCount(row) === cellCount(headerRow);
}

// A table is only a table once its delimiter row exists, so until then the header would show up as a paragraph.
function healTable(lines: readonly string[]): string[] | null {
  const last = lines.at(-1) ?? "";
  const previous = lines.at(-2);
  const headerPending = previous !== undefined && PIPE_ROW.test(previous) && isBlank(lines.at(-3));
  if (headerPending && PARTIAL_DELIMITER_ROW.test(last)) {
    return isDelimiterRowFor(last, previous) ? null : [...lines.slice(0, -1), delimiterRowFor(previous)];
  }
  return PIPE_ROW.test(last) && isBlank(previous) ? [...lines, delimiterRowFor(last)] : null;
}

function toggleCodeRun(openRun: number, run: number): number {
  if (openRun === 0) return run;
  return openRun === run ? 0 : openRun;
}

interface InlineState {
  codeRun: number;
  bold: boolean;
  strike: boolean;
}

function advance(state: InlineState, [, backticks, stars, tildes]: RegExpExecArray): InlineState {
  if (backticks !== undefined) return { ...state, codeRun: toggleCodeRun(state.codeRun, backticks.length) };
  if (state.codeRun !== 0) return state;
  if (stars?.length === 2) return { ...state, bold: !state.bold };
  if (tildes?.length === 2) return { ...state, strike: !state.strike };
  return state;
}

function closingFor(line: string): string {
  const { codeRun, bold, strike } = [...line.matchAll(INLINE_MARKER)].reduce(advance, { codeRun: 0, bold: false, strike: false });
  return "`".repeat(codeRun) + (strike ? "~~" : "") + (bold ? "**" : "");
}

function healInline(line: string): string {
  const closed = line + closingFor(line);
  return PARTIAL_LINK_DESTINATION.test(closed) ? `${closed})` : closed;
}

/** Repairs the unfinished end of `text` so that markdown parsed from it looks like the text will once it is complete. */
export function healPartialMarkdown(text: string): string {
  const lines = text.split("\n");
  const last = lines.at(-1) ?? "";
  if (PARTIAL_FENCE.test(last)) return hasOpenFence(lines.slice(0, -1)) ? lines.slice(0, -1).join("\n") : text;
  if (hasOpenFence(lines)) return text;
  const table = healTable(lines);
  if (table !== null) return table.join("\n");
  return [...lines.slice(0, -1), healInline(last)].join("\n");
}
