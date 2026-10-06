import { describe, expect, test } from "bun:test";

import { phantomLines, positionAt, previewTyping, typingLabel } from "./typing-preview";

const edit = (oldString: string, text: string) => ({ kind: "edit", oldString, text }) as const;

describe("positionAt", () => {
  test.each([
    ["", 0, 1, 1],
    ["abc", 2, 1, 3],
    ["ab\ncd", 3, 2, 1],
    ["ab\ncd", 5, 2, 3],
    ["ab\r\ncd", 4, 2, 1],
    ["a\n\n\nb", 4, 4, 1],
  ])("puts offset of %j at the right line and column", (text, offset, line, column) => {
    expect(positionAt(text, offset)).toEqual({ line, column });
  });
});

describe("previewTyping an edit", () => {
  const file = "one\ntwo\nthree\nfour\n";

  test("swaps the old text for what has been typed and marks where it sits", () => {
    const view = previewTyping(file, edit("two\nthree", "2\n3"));
    expect(view).toEqual({
      content: "one\n2\n3\nfour\n",
      typedStart: { line: 2, column: 1 },
      typedEnd: { line: 3, column: 2 },
      replaced: ["two", "three"],
    });
  });

  test("shows an empty typed range while nothing has been typed yet", () => {
    const view = previewTyping(file, edit("three", ""));
    expect(view?.content).toBe("one\ntwo\n\nfour\n");
    expect(view?.typedStart).toEqual(view?.typedEnd ?? { line: 0, column: 0 });
  });

  test("puts the caret at the end of the typed text, mid-line", () => {
    const view = previewTyping("const a = 1;\n", edit("1", "2 + "));
    expect(view?.content).toBe("const a = 2 + ;\n");
    expect(view?.typedEnd).toEqual({ line: 1, column: 15 });
  });

  test("uses the first place the old text occurs", () => {
    expect(previewTyping("x\nx\n", edit("x", "y"))?.content).toBe("y\nx\n");
  });

  test("works with CRLF files", () => {
    const view = previewTyping("a\r\nb\r\nc\r\n", edit("b", "B1\r\nB2"));
    expect(view?.typedStart).toEqual({ line: 2, column: 1 });
    expect(view?.typedEnd).toEqual({ line: 3, column: 3 });
  });

  test("has nowhere to put the text when the old text is missing, empty or unknown", () => {
    expect(previewTyping(file, edit("nope", "x"))).toBeNull();
    expect(previewTyping(file, edit("", "x"))).toBeNull();
    expect(previewTyping(file, { kind: "edit", oldString: null, text: "x" })).toBeNull();
  });
});

describe("previewTyping a write", () => {
  test("is the typed text from the first line", () => {
    const view = previewTyping("old contents", { kind: "write", oldString: null, text: "a\nbc" });
    expect(view).toEqual({
      content: "a\nbc",
      typedStart: { line: 1, column: 1 },
      typedEnd: { line: 2, column: 3 },
      replaced: [],
    });
  });

  test("is empty before anything is typed", () => {
    expect(previewTyping("", { kind: "write", oldString: null, text: "" })?.content).toBe("");
  });
});

describe("typingLabel", () => {
  const view = (text: string) => previewTyping("a\nb\nc\n", edit("b", text));
  const typed = view("x\ny\nz");

  test("names the lines being typed", () => {
    expect(typed && typingLabel(typed, { created: false, kind: "edit" })).toBe("Claude · editing lines 2–4");
    const single = view("x");
    expect(single && typingLabel(single, { created: false, kind: "edit" })).toBe("Claude · editing line 2");
  });

  test("says a new file is being written", () => {
    const written = previewTyping("", { kind: "write", oldString: null, text: "a" });
    expect(written && typingLabel(written, { created: true, kind: "write" })).toBe("Claude · writing a new file");
  });

  test("says an existing file is being rewritten", () => {
    const written = previewTyping("old", { kind: "write", oldString: null, text: "a\nb" });
    expect(written && typingLabel(written, { created: false, kind: "write" })).toBe("Claude · writing lines 1–2");
  });
});

describe("phantomLines", () => {
  test("shows up to thirty removed lines and counts the rest", () => {
    const removed = Array.from({ length: 45 }, (_, index) => `line ${String(index)}`);
    const { shown, hidden } = phantomLines(removed);
    expect(shown).toHaveLength(30);
    expect(hidden).toBe(15);
  });

  test("hides nothing when there are few", () => {
    expect(phantomLines(["a", "b"])).toEqual({ shown: ["a", "b"], hidden: 0 });
  });
});
