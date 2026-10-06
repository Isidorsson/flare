import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { classifyTool, MAX_SEARCH_READ_EVENTS, searchResultPaths } from "./tools";

const CWD = resolve("/work/app");

describe("classifyTool", () => {
  test("treats Read as a read of the resolved file path", () => {
    expect(classifyTool("Read", { file_path: "src/a.ts" }, CWD)).toEqual({ kind: "read", path: resolve(CWD, "src/a.ts") });
  });

  test("keeps absolute paths", () => {
    const absolute = resolve("/elsewhere/b.ts");
    expect(classifyTool("Read", { file_path: absolute }, CWD)).toEqual({ kind: "read", path: absolute });
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

  test.each(["Grep", "Glob"])("treats %s as a search", (name) => {
    expect(classifyTool(name, { pattern: "foo" }, CWD)).toEqual({ kind: "search" });
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
