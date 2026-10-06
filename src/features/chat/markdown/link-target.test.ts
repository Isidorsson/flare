import { describe, expect, test } from "bun:test";

import { classifyHref, classifyImageHref } from "./link-target";

describe("web links", () => {
  test("http, https and mailto leave the app, in their parsed form", () => {
    expect(classifyHref("https://example.com/a?b=1")).toEqual({ kind: "external", url: "https://example.com/a?b=1" });
    expect(classifyHref("http://localhost:3000")).toEqual({ kind: "external", url: "http://localhost:3000/" });
    expect(classifyHref("mailto:me@example.com")).toEqual({ kind: "external", url: "mailto:me@example.com" });
    expect(classifyHref("  HTTPS://Example.com/x  ")).toEqual({ kind: "external", url: "https://example.com/x" });
  });

  test("a url that only looks like a file name is still a url", () => {
    expect(classifyHref("https://example.com/src/a.ts:42")).toMatchObject({ kind: "external" });
  });
});

describe("destinations that must never be opened", () => {
  const hostile = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(document.cookie)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    " \u0001javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///C:/Windows/System32/cmd.exe",
    "tauri://localhost/",
    "ipc://localhost/",
    "ftp://example.com/a.txt",
    "//evil.example.com/a.js",
    "\\\\server\\share\\a.txt",
    "#section",
    "?q=1",
    "",
    "   ",
  ];

  for (const href of hostile) {
    test(`${JSON.stringify(href)} does nothing`, () => {
      expect(classifyHref(href)).toEqual({ kind: "none" });
    });
  }
});

describe("project files", () => {
  test("relative paths, with or without a position, open in Files", () => {
    expect(classifyHref("src/foo.ts")).toEqual({ kind: "file", target: { path: "src/foo.ts", line: null, column: null } });
    expect(classifyHref("src/foo.ts:42")).toEqual({ kind: "file", target: { path: "src/foo.ts", line: 42, column: null } });
    expect(classifyHref("./src/foo.ts:42:7")).toEqual({ kind: "file", target: { path: "./src/foo.ts", line: 42, column: 7 } });
    expect(classifyHref("src/foo.ts#L12")).toEqual({ kind: "file", target: { path: "src/foo.ts", line: 12, column: null } });
  });

  test("a bare file name with a position is not mistaken for a url scheme", () => {
    expect(classifyHref("foo.ts:42")).toEqual({ kind: "file", target: { path: "foo.ts", line: 42, column: null } });
  });

  test("windows drive paths are files, not schemes", () => {
    expect(classifyHref("C:\\proj\\src\\a.ts:5")).toEqual({
      kind: "file",
      target: { path: "C:\\proj\\src\\a.ts", line: 5, column: null },
    });
    expect(classifyHref("C:/proj/a.ts")).toMatchObject({ kind: "file" });
  });

  test("a host and port is neither a file nor a url", () => {
    expect(classifyHref("localhost:3000")).toEqual({ kind: "none" });
  });
});

describe("images", () => {
  test("a remote image is offered as a link, never fetched", () => {
    expect(classifyImageHref("https://example.com/a.png")).toEqual({ kind: "external", url: "https://example.com/a.png" });
  });

  test("anything else is only its description", () => {
    expect(classifyImageHref("data:image/png;base64,AAAA")).toEqual({ kind: "none" });
    expect(classifyImageHref("src/a.png")).toEqual({ kind: "none" });
    expect(classifyImageHref("mailto:me@example.com")).toEqual({ kind: "none" });
  });
});
