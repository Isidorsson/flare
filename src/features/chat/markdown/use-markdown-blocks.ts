import { useState } from "react";

import { EMPTY_PARSE, parseMarkdown, type Block } from "./parse";

/**
 * The top-level blocks of `text`. Blocks that can no longer change keep their identity from one call to the next,
 * so memoised block components skip them while a reply streams in.
 */
export function useMarkdownBlocks(text: string, streaming: boolean): readonly Block[] {
  const [parsed, setParsed] = useState(() => parseMarkdown(EMPTY_PARSE, text, streaming));
  if (parsed.text === text && parsed.streaming === streaming) return parsed.blocks;
  const next = parseMarkdown(parsed, text, streaming);
  setParsed(next);
  return next.blocks;
}
