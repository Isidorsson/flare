import { useEffect, useState } from "react";

import type { ColorizedLine } from "@/features/files";

import { useMarkdownServices } from "./services";

/** Past this size a snippet stays plain: colouring it again on every new line would cost more than it is worth. */
export const HIGHLIGHT_MAX_CHARS = 60_000;

export interface Highlight {
  /** The exact text the lines were made from. */
  readonly source: string;
  readonly lines: readonly ColorizedLine[];
}

/**
 * The part of a code block that can be coloured. While the block is still being written its last line is left out,
 * so a line is only coloured once it is complete and the colours already on screen never change.
 */
export function colourableSource(code: string, open: boolean): string {
  return open ? code.slice(0, code.lastIndexOf("\n") + 1) : code;
}

/** Colours `source` with Monaco once it is available. Until then, and for unknown languages, it stays null. */
export function useHighlight(source: string, language: string | null): Highlight | null {
  const { colorize } = useMarkdownServices();
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  useEffect(() => {
    if (language === null || source === "" || source.length > HIGHLIGHT_MAX_CHARS) return;
    let current = true;
    colorize(source, language)
      .then((lines) => {
        if (current && lines !== null) setHighlight({ source, lines });
      })
      .catch((error: unknown) => {
        if (current) console.error(`flare: could not colour ${language} code`, error);
      });
    return () => {
      current = false;
    };
  }, [colorize, source, language]);

  return highlight;
}
