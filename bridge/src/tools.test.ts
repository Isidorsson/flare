import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { MAX_MATCH_LINES } from "@flare/protocol";

import {
  classifyTool,
  DEFAULT_READ_LINE_LIMIT,
  MAX_SEARCH_READ_EVENTS,
  searchResultPaths,
  singleFileMatches,
} from "./tools";

const CWD = resolve("/work/app");

describe("classifyTool", () => {
  test("treats Read as a read of the resolved file path, defaulting to the lines Read returns", () => {
    expect(classifyTool("Read", { file_path: "src/a.ts" }, CWD)).toEqual({
      kind: "read",
      path: resolve(CWD, "src/a.ts"),
      range: { start: 1, end: DEFAULT_READ_LINE_LIMIT },
    });
  });

  test("keeps absolute paths", () => {
    const absolute = resolve("/elsewhere/b.ts");
    expect(classifyTool("Read", { file_path: absolute }, CWD)).toMatchObject({ kind: "read", path: absolute });
  });

  test.each([
    [{ offset: 50, limit: 20 }, { start: 50, end: 69 }],
    [{ offset: 10 }, { start: 10, end: 10 + DEFAULT_READ_LINE_LIMIT - 1 }],
    [{ limit: 30 }, { start: 1, end: 30 }],
    [{ offset: 0, limit: 5 }, { start: 1, end: 5 }],
    [{ offset: "12", limit: -3 }, { start: 1, end: DEFAULT_READ_LINE_LIMIT }],
  ])("derives the range of a Read with %j", (extra, range) => {
    expect(classifyTool("Read", { file_path: "a.ts", ...extra }, CWD)).toMatchObject({ kind: "read", range });
  });

  test.each(["Edit", "Write", "MultiEdit"])("treats %s as a change of the file", (name) => {
    expect(classifyTool(name, { file_path: "a.ts" }, CWD)).toEqual({ kind: "change", path: resolve(CWD, "a.ts") });
  });

  test("treats NotebookEdit as a change of the notebook", () => {
    expect(classifyTool("NotebookEdit", { notebook_path: "n.ipynb" }, CWD)).toEqual({
      kind: "change",
      path: resolve(CWD, "n.ipynb"),
    });
  });

  test("treats Glob as a search without a pattern to show", () => {
    expect(classifyTool("Glob", { pattern: "**/*.ts" }, CWD)).toEqual({
      kind: "search",
      tool: "Glob",
      pattern: null,
      target: null,
      contentMode: false,
    });
  });

  test("treats Grep as a search that remembers its pattern, target and mode", () => {
    expect(classifyTool("Grep", { pattern: "foo", path: "src/a.ts", output_mode: "content" }, CWD)).toEqual({
      kind: "search",
      tool: "Grep",
      pattern: "foo",
      target: resolve(CWD, "src/a.ts"),
      contentMode: true,
    });
    expect(classifyTool("Grep", { pattern: "foo" }, CWD)).toEqual({
      kind: "search",
      tool: "Grep",
      pattern: "foo",
      target: null,
      contentMode: false,
    });
  });

  test("falls back to other for unknown tools and for malformed inputs", () => {
    expect(classifyTool("Bash", { command: "ls" }, CWD)).toEqual({ kind: "other" });
    expect(classifyTool("Edit", { path: "a.ts" }, CWD)).toEqual({ kind: "other" });
    expect(classifyTool("Read", "a.ts", CWD)).toEqual({ kind: "other" });
    expect(classifyTool("Read", { file_path: "" }, CWD)).toEqual({ kind: "other" });
  });
});

describe("searchResultPaths", () => {
  test("resolves the matched files against the working directory", () => {
    expect(searchResultPaths({ filenames: ["src/a.ts", resolve("/abs/b.ts")] }, CWD)).toEqual([
      resolve(CWD, "src/a.ts"),
      resolve("/abs/b.ts"),
    ]);
  });

  test("caps the number of files so a broad glob cannot flood the app", () => {
    const filenames = Array.from({ length: MAX_SEARCH_READ_EVENTS + 10 }, (_, index) => `f${index}.ts`);
    expect(searchResultPaths({ filenames }, CWD)).toHaveLength(MAX_SEARCH_READ_EVENTS);
  });

  test("returns nothing when the structured result is missing or malformed", () => {
    expect(searchResultPaths(undefined, CWD)).toEqual([]);
    expect(searchResultPaths({ filenames: "a.ts" }, CWD)).toEqual([]);
    expect(searchResultPaths({ numFiles: 3 }, CWD)).toEqual([]);
  });

  test("skips empty file names", () => {
    expect(searchResultPaths({ filenames: ["", "a.ts"] }, CWD)).toEqual([resolve(CWD, "a.ts")]);
  });
});

describe("singleFileMatches", () => {
  const search = classifyTool("Grep", { pattern: "use", path: "src/a.ts", output_mode: "content" }, CWD);
  const content = (text: string) => ({ mode: "content", numFiles: 0, filenames: [], content: text });

  test("reads the matching lines of a one-file search, ignoring context lines and group breaks", () => {
    const result = singleFileMatches(search, content("3:use a\n4-ctx\n--\n18:use b\n18:use b again\n42:use c"));
    expect(result).toEqual({ pattern: "use", path: resolve(CWD, "src/a.ts"), matchLines: [3, 18, 42] });
  });

  test("keeps text that itself contains line-number-looking prefixes", () => {
    expect(singleFileMatches(search, content("7:const x = 12:34"))?.matchLines).toEqual([7]);
  });

  test("returns nothing for a directory search, whose lines start with the file name", () => {
    expect(singleFileMatches(search, content("src/a.ts:3:use a\nsrc/b.ts:9:use b"))).toBeNull();
  });

  test("returns nothing when there are no numbered match lines", () => {
    expect(singleFileMatches(search, content(""))).toBeNull();
    expect(singleFileMatches(search, content("4-only context"))).toBeNull();
    expect(singleFileMatches(search, content("no line numbers here"))).toBeNull();
  });

  test("needs a content-mode Grep of an explicit path and a structured result", () => {
    const listing = classifyTool("Grep", { pattern: "use", path: "src/a.ts" }, CWD);
    const everywhere = classifyTool("Grep", { pattern: "use", output_mode: "content" }, CWD);
    expect(singleFileMatches(listing, content("3:use"))).toBeNull();
    expect(singleFileMatches(everywhere, content("3:use"))).toBeNull();
    expect(singleFileMatches(search, undefined)).toBeNull();
    expect(singleFileMatches(search, { mode: "files_with_matches", content: "3:use", filenames: [] })).toBeNull();
    expect(singleFileMatches(classifyTool("Read", { file_path: "a.ts" }, CWD), content("3:use"))).toBeNull();
  });

  test("caps the matching lines", () => {
    const text = Array.from({ length: MAX_MATCH_LINES + 50 }, (_, index) => `${index + 1}:hit`).join("\n");
    expect(singleFileMatches(search, content(text))?.matchLines).toHaveLength(MAX_MATCH_LINES);
  });
});
