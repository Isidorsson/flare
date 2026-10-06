import { describe, expect, test } from "bun:test";

import { EMPTY_PARSE, parseMarkdown, type Block, type ParseState } from "./parse";

function shape(blocks: readonly Block[]): string {
  return JSON.stringify(
    blocks.map((block) => block.node),
    (key, value: unknown) => (key === "position" ? undefined : value),
  );
}

function types(state: ParseState): string[] {
  return state.blocks.map((block) => block.node.type);
}

function stream(chunks: readonly string[], streaming = true): ParseState {
  let state = EMPTY_PARSE;
  let text = "";
  for (const chunk of chunks) {
    text += chunk;
    state = parseMarkdown(state, text, streaming);
  }
  return state;
}

const DOCUMENT = [
  "# Plan",
  "",
  "Some *intro* text with `code`, a [link](https://example.com) and ~~old~~ words.",
  "Second line of the same paragraph.",
  "",
  "- first",
  "  - nested one",
  "  - nested two",
  "- second",
  "",
  "  continues the second item",
  "",
  "1. one",
  "2. two",
  "",
  "- [x] done",
  "- [ ] todo",
  "",
  "> quoted",
  "> more quoted",
  "",
  "```ts",
  "const a = 1;",
  "",
  "const b = 2;",
  "```",
  "",
  "| a | b |",
  "| --- | :-: |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "",
  "---",
  "",
  "Title",
  "=====",
  "",
  "Last paragraph.",
].join("\n");

describe("streaming a document in", () => {
  test("every prefix parses to what a fresh parse of the same prefix gives", () => {
    let state = EMPTY_PARSE;
    for (let end = 1; end <= DOCUMENT.length; end += 1) {
      const text = DOCUMENT.slice(0, end);
      state = parseMarkdown(state, text, true);
      expect(shape(state.blocks)).toBe(shape(parseMarkdown(EMPTY_PARSE, text, true).blocks));
    }
  });

  test("the finished text parses to exactly the plain, unrepaired markdown", () => {
    const streamed = stream(DOCUMENT.match(/[\s\S]{1,7}/g) ?? [], true);
    const finished = parseMarkdown(streamed, DOCUMENT, false);
    expect(shape(finished.blocks)).toBe(shape(parseMarkdown(EMPTY_PARSE, DOCUMENT, false).blocks));
    expect(types(finished)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "list",
      "blockquote",
      "code",
      "table",
      "thematicBreak",
      "heading",
      "paragraph",
    ]);
  });

  test("a long chunk that completes several blocks at once is handled", () => {
    const state = stream(["# One\n\npara\n\n- a\n- b\n\nlast"]);
    expect(types(state)).toEqual(["heading", "paragraph", "list", "paragraph"]);
  });
});

describe("blocks that can no longer change", () => {
  test("keep their identity while later text streams in, so they are not rendered again", () => {
    const first = stream(["# Title\n\nfirst paragraph\n\nsecond par"]);
    const [heading, paragraph, tail] = first.blocks;
    const next = parseMarkdown(first, "# Title\n\nfirst paragraph\n\nsecond paragraph, longer", true);
    expect(next.blocks[0]).toBe(heading);
    expect(next.blocks[1]).toBe(paragraph);
    expect(next.blocks[2]).not.toBe(tail);
    expect(next.settled).toHaveLength(2);
    expect(next.settledEnd).toBe("# Title\n\nfirst paragraph".length);
  });

  test("only the last block is ever open", () => {
    const state = stream(["a\n\nb\n\nc\n\nd"]);
    expect(state.settled.map((block) => block.key)).toEqual([0, 1, 2]);
    expect(state.blocks.map((block) => block.key)).toEqual([0, 1, 2, 3]);
  });

  test("a list stays open across a blank line, because an indented paragraph may still join it", () => {
    const state = stream(["- a\n- b\n\n"]);
    expect(state.settled).toHaveLength(0);
    const joined = parseMarkdown(state, "- a\n- b\n\n  more for b", true);
    expect(types(joined)).toEqual(["list"]);
  });

  test("parsing restarts when the text is no longer an extension of what was settled", () => {
    const first = stream(["alpha\n\nbeta\n\ngamma"]);
    const replaced = parseMarkdown(first, "ALPHA\n\nBETA\n\nGAMMA", false);
    expect(shape(replaced.blocks)).toBe(shape(parseMarkdown(EMPTY_PARSE, "ALPHA\n\nBETA\n\nGAMMA", false).blocks));
  });
});

describe("half-finished markdown", () => {
  test("an open code fence is one code block that grows", () => {
    const state = stream(["```ts\nconst a = 1;\n", "const b = 2;"]);
    expect(types(state)).toEqual(["code"]);
    expect(state.blocks[0]?.node).toMatchObject({ type: "code", lang: "ts", value: "const a = 1;\nconst b = 2;" });
  });

  test("text after a finished fence is outside it", () => {
    const state = stream(["```\nx\n```\nafter"]);
    expect(types(state)).toEqual(["code", "paragraph"]);
  });

  test("a half-typed closing fence does not leak into the code", () => {
    const state = stream(["```\nx = 1\n``"]);
    expect(state.blocks[0]?.node).toMatchObject({ type: "code", value: "x = 1" });
  });

  test("a table header is a table before its delimiter row arrives", () => {
    expect(types(stream(["| a | b |"]))).toEqual(["table"]);
    expect(types(stream(["| a | b |\n"]))).toEqual(["table"]);
    expect(types(stream(["| a | b |\n|-"]))).toEqual(["table"]);
    expect(types(stream(["| a | b |\n| --- | --- |\n| 1"]))).toEqual(["table"]);
  });

  test("table rows appear one by one inside the same block", () => {
    const rows = (text: string): number => {
      const node = stream([text]).blocks[0]?.node;
      return node?.type === "table" ? node.children.length : -1;
    };
    expect(rows("| a | b |\n| --- | --- |")).toBe(1);
    expect(rows("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(2);
    expect(rows("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 |")).toBe(3);
  });

  test("a list grows item by item and an empty bullet is an item", () => {
    const items = (text: string): number => {
      const node = stream([text]).blocks[0]?.node;
      return node?.type === "list" ? node.children.length : -1;
    };
    expect(items("- a")).toBe(1);
    expect(items("- a\n- b")).toBe(2);
    expect(items("- a\n- b\n- ")).toBe(3);
  });

  test("unfinished emphasis, code and links already look final while streaming", () => {
    const inline = (text: string) => {
      const node = stream([text]).blocks[0]?.node;
      return node?.type === "paragraph" ? node.children.map((child) => child.type) : [];
    };
    expect(inline("a **bold")).toEqual(["text", "strong"]);
    expect(inline("run `npm")).toEqual(["text", "inlineCode"]);
    expect(inline("see [docs](https://exa")).toEqual(["text", "link"]);
  });

  test("the same text is plain once streaming stops: nothing is repaired in a finished message", () => {
    const inline = (text: string) => {
      const node = parseMarkdown(EMPTY_PARSE, text, false).blocks[0]?.node;
      return node?.type === "paragraph" ? node.children.map((child) => child.type) : [];
    };
    expect(inline("a **bold")).toEqual(["text"]);
    expect(inline("run `npm")).toEqual(["text"]);
  });
});

describe("what the parser does not turn into markup", () => {
  test("a single tilde is not strikethrough", () => {
    const node = parseMarkdown(EMPTY_PARSE, "takes ~5 min or ~10 min", false).blocks[0]?.node;
    expect(node?.type === "paragraph" ? node.children.map((child) => child.type) : []).toEqual(["text"]);
  });

  test("raw html stays an html node for the renderer to show as text", () => {
    const state = parseMarkdown(EMPTY_PARSE, "<script>alert(1)</script>\n\nhi <b>x</b>", false);
    expect(types(state)).toEqual(["html", "paragraph"]);
  });

  test("an empty or blank message has no blocks", () => {
    expect(parseMarkdown(EMPTY_PARSE, "", true).blocks).toHaveLength(0);
    expect(parseMarkdown(EMPTY_PARSE, "  \n\n ", false).blocks).toHaveLength(0);
  });
});
