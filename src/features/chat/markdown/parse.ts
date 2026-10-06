import type { RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { healPartialMarkdown } from "./heal";

export interface Block {
  /** Index among the message's top-level blocks. A settled block keeps its key and its object for good. */
  readonly key: number;
  readonly node: RootContent;
}

export interface ParseState {
  readonly text: string;
  readonly streaming: boolean;
  /** Where the settled blocks end in `text`. Only the text after it is parsed again. */
  readonly settledEnd: number;
  readonly settled: readonly Block[];
  readonly blocks: readonly Block[];
}

// `~5 min` and `~10 min` must not strike text through, so only `~~` counts as strikethrough.
const PARSE_OPTIONS = { extensions: [gfm({ singleTilde: false })], mdastExtensions: [gfmFromMarkdown()] };

export const EMPTY_PARSE: ParseState = { text: "", streaming: false, settledEnd: 0, settled: [], blocks: [] };

function endOffset(node: RootContent): number {
  const offset = node.position?.end.offset;
  if (offset === undefined) throw new Error(`The ${node.type} node has no source position`);
  return offset;
}

function canExtend(previous: ParseState, text: string): boolean {
  return text.startsWith(previous.text.slice(0, previous.settledEnd));
}

/**
 * Parses `text`, reusing what `previous` already settled. Every top-level block except the last can no longer
 * change as text is appended, so those are kept as they are and only the rest of the text is parsed again.
 * While `streaming`, the unfinished end is repaired first (see `healPartialMarkdown`).
 */
export function parseMarkdown(previous: ParseState, text: string, streaming: boolean): ParseState {
  const base = canExtend(previous, text) ? previous : EMPTY_PARSE;
  const tail = text.slice(base.settledEnd);
  const nodes = fromMarkdown(streaming ? healPartialMarkdown(tail) : tail, PARSE_OPTIONS).children;
  const closed = nodes.slice(0, -1);
  const closedEnd = closed.at(-1);
  const settled =
    closed.length === 0 ? base.settled : [...base.settled, ...closed.map((node, index) => ({ key: base.settled.length + index, node }))];
  const open = nodes.at(-1);
  return {
    text,
    streaming,
    settledEnd: closedEnd === undefined ? base.settledEnd : base.settledEnd + endOffset(closedEnd),
    settled,
    blocks: open === undefined ? settled : [...settled, { key: settled.length, node: open }],
  };
}
