import { describe, expect, test } from "bun:test";

import { healPartialMarkdown } from "./heal";

describe("inline markers", () => {
  test("closes an unfinished code span, bold and strikethrough", () => {
    expect(healPartialMarkdown("run `npm i")).toBe("run `npm i`");
    expect(healPartialMarkdown("this is **very impor")).toBe("this is **very impor**");
    expect(healPartialMarkdown("gone ~~old")).toBe("gone ~~old~~");
  });

  test("leaves finished markers alone", () => {
    expect(healPartialMarkdown("a **b** and `c` and ~~d~~")).toBe("a **b** and `c` and ~~d~~");
  });

  test("closes the code span before the bold that contains it", () => {
    expect(healPartialMarkdown("**use `foo")).toBe("**use `foo`**");
  });

  test("markers inside a code span, and escaped ones, do not count", () => {
    expect(healPartialMarkdown("`a ** b`")).toBe("`a ** b`");
    expect(healPartialMarkdown("a \\** b")).toBe("a \\** b");
    expect(healPartialMarkdown("`` a ` b")).toBe("`` a ` b``");
  });

  test("only the last line is repaired", () => {
    expect(healPartialMarkdown("first **open\nsecond `line")).toBe("first **open\nsecond `line`");
  });

  test("a single * or ~ is not a marker: bullets and approximations stay as written", () => {
    expect(healPartialMarkdown("* item\n~5 min, ~10 min")).toBe("* item\n~5 min, ~10 min");
  });

  test("an unfinished link destination is closed so the link text looks final", () => {
    expect(healPartialMarkdown("see [the docs](https://exa")).toBe("see [the docs](https://exa)");
    expect(healPartialMarkdown("see [the docs](")).toBe("see [the docs]()");
    expect(healPartialMarkdown("![logo](img/lo")).toBe("![logo](img/lo)");
    expect(healPartialMarkdown("see [the docs](https://example.com) and")).toBe("see [the docs](https://example.com) and");
  });
});

describe("code fences", () => {
  test("text inside an open fence is code and is left alone", () => {
    const text = "```ts\nconst a = `x\nconst b = **";
    expect(healPartialMarkdown(text)).toBe(text);
  });

  test("a closing fence that is only half typed does not show up as code", () => {
    expect(healPartialMarkdown("```ts\nconst a = 1\n``")).toBe("```ts\nconst a = 1");
    expect(healPartialMarkdown("~~~\nx\n~")).toBe("~~~\nx");
  });

  test("a finished fence no longer protects the text after it", () => {
    expect(healPartialMarkdown("```\nx\n```\nthen **bold")).toBe("```\nx\n```\nthen **bold**");
  });

  test("a longer fence is only closed by an equal or longer one", () => {
    const text = "````md\n```\nstill code **";
    expect(healPartialMarkdown(text)).toBe(text);
  });

  test("a fence that is only starting is left for the parser", () => {
    expect(healPartialMarkdown("intro\n``")).toBe("intro\n``");
    expect(healPartialMarkdown("intro\n```")).toBe("intro\n```");
  });

  test("fences inside list items count too", () => {
    const text = "- step\n  ```sh\n  npm i `x";
    expect(healPartialMarkdown(text)).toBe(text);
  });
});

describe("tables", () => {
  test("a complete header row gets its delimiter row so it already looks like a table", () => {
    expect(healPartialMarkdown("| a | b |")).toBe("| a | b |\n| --- | --- |");
    expect(healPartialMarkdown("intro\n\n| a | b | c |")).toBe("intro\n\n| a | b | c |\n| --- | --- | --- |");
  });

  test("a header followed by a half-written delimiter row is completed", () => {
    expect(healPartialMarkdown("| a | b |\n")).toBe("| a | b |\n| --- | --- |");
    expect(healPartialMarkdown("| a | b |\n|")).toBe("| a | b |\n| --- | --- |");
    expect(healPartialMarkdown("| a | b |\n|---")).toBe("| a | b |\n| --- | --- |");
    expect(healPartialMarkdown("| a | b |\n|:--|--")).toBe("| a | b |\n| --- | --- |");
  });

  test("a finished delimiter row, with its alignment, is not replaced", () => {
    const text = "| a | b |\n|:--|--:|";
    expect(healPartialMarkdown(text)).toBe(text);
  });

  test("body rows are left to the parser", () => {
    const text = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(healPartialMarkdown(text)).toBe(text);
    expect(healPartialMarkdown("| a | b |\n| --- | --- |\n| 1 | **2")).toBe("| a | b |\n| --- | --- |\n| 1 | **2**");
  });

  test("a pipe row in the middle of a paragraph is not a table header", () => {
    expect(healPartialMarkdown("text\n| a | b |")).toBe("text\n| a | b |");
  });

  test("a header row that is still being typed is left alone", () => {
    expect(healPartialMarkdown("| a | b")).toBe("| a | b");
  });
});
