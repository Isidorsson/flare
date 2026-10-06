import { describe, expect, test } from "bun:test";

import { parseFileDestination, parseFileReference, splitFileReferences, type TextSegment } from "./file-refs";

function files(text: string): string[] {
  return splitFileReferences(text).flatMap((segment) => (segment.kind === "file" ? [segment.text] : []));
}

function target(text: string) {
  const found = splitFileReferences(text).find((segment): segment is Extract<TextSegment, { kind: "file" }> => segment.kind === "file");
  return found?.target;
}

describe("splitFileReferences", () => {
  test("finds a path with a line in a sentence and keeps the surrounding text", () => {
    expect(splitFileReferences("Look at src/foo.ts:42 for the bug.")).toEqual([
      { kind: "text", text: "Look at " },
      { kind: "file", text: "src/foo.ts:42", target: { path: "src/foo.ts", line: 42, column: null } },
      { kind: "text", text: " for the bug." },
    ]);
  });

  test("reads a column and a #L line suffix", () => {
    expect(target("at src/a/b.tsx:12:5")).toEqual({ path: "src/a/b.tsx", line: 12, column: 5 });
    expect(target("see src/a.rs#L30")).toEqual({ path: "src/a.rs", line: 30, column: null });
  });

  test("a path without a line is a reference when it has a folder", () => {
    expect(files("edit src/lib/index.ts now")).toEqual(["src/lib/index.ts"]);
    expect(files("see ./a.ts and ../b/c.json")).toEqual(["./a.ts", "../b/c.json"]);
  });

  test("a bare name needs a line: prose is not a file", () => {
    expect(files("main.rs:7 is the entry")).toEqual(["main.rs:7"]);
    expect(files("README.md has the details")).toEqual([]);
    expect(files("Node.js and e.g. foo.bar() and v1.2.3")).toEqual([]);
  });

  test("sentence punctuation stays outside the reference", () => {
    expect(files("Changed src/a.ts.")).toEqual(["src/a.ts"]);
    expect(files("(see src/a.ts:3), and src/b.ts;")).toEqual(["src/a.ts:3", "src/b.ts"]);
    expect(files("is it src/a.ts?")).toEqual(["src/a.ts"]);
  });

  test("windows paths with drive letters and backslashes", () => {
    expect(target("open C:\\proj\\src\\a.ts:9 please")).toEqual({ path: "C:\\proj\\src\\a.ts", line: 9, column: null });
    expect(files("also src\\lib\\b.ts")).toEqual(["src\\lib\\b.ts"]);
  });

  test("urls and e-mail addresses are left alone", () => {
    expect(files("see https://example.com/src/a.ts:3 or ftp://host/b/c.ts")).toEqual([]);
    expect(files("write to dev@example.com")).toEqual([]);
  });

  test("a line of zero is not a line", () => {
    expect(target("src/a.ts:0 is odd")).toEqual({ path: "src/a.ts", line: null, column: null });
  });

  test("text with nothing in it comes back as one text segment", () => {
    expect(splitFileReferences("nothing to see")).toEqual([{ kind: "text", text: "nothing to see" }]);
    expect(splitFileReferences("")).toEqual([]);
  });
});

describe("parseFileReference (inline code)", () => {
  test("accepts a whole span that names a file, with or without a position", () => {
    expect(parseFileReference("src/foo.ts:42")).toEqual({ path: "src/foo.ts", line: 42, column: null });
    expect(parseFileReference("src/foo.ts")).toEqual({ path: "src/foo.ts", line: null, column: null });
    expect(parseFileReference("Cargo.toml")).toEqual({ path: "Cargo.toml", line: null, column: null });
    expect(parseFileReference("package.json")).toMatchObject({ path: "package.json" });
  });

  test("a bare name needs a familiar extension, so code is not mistaken for a file", () => {
    expect(parseFileReference("console.log")).toBeNull();
    expect(parseFileReference("user.name")).toBeNull();
    expect(parseFileReference("Array.map")).toBeNull();
  });

  test("only a span that is entirely a path counts", () => {
    expect(parseFileReference("open src/a.ts")).toBeNull();
    expect(parseFileReference("src/a.ts()")).toBeNull();
    expect(parseFileReference("")).toBeNull();
    expect(parseFileReference("//server/a.ts")).toBeNull();
  });
});

describe("parseFileDestination (link targets)", () => {
  test("takes any extension, because the author linked it on purpose", () => {
    expect(parseFileDestination("docs/notes.weird:3")).toEqual({ path: "docs/notes.weird", line: 3, column: null });
  });

  test("rejects directories and anything that is not a path", () => {
    expect(parseFileDestination("src/lib")).toBeNull();
    expect(parseFileDestination("a b.ts")).toBeNull();
  });
});
