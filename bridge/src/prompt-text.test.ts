import { describe, expect, test } from "bun:test";

import { clipText, singleLine } from "./prompt-text";

describe("clipText", () => {
  test("keeps text at or under the limit", () => {
    expect(clipText("abc", 3)).toEqual({ text: "abc", cut: false });
    expect(clipText("", 3)).toEqual({ text: "", cut: false });
  });

  test("cuts text over the limit", () => {
    expect(clipText("abcd", 3)).toEqual({ text: "abc", cut: true });
  });

  test("does not leave half of a surrogate pair behind", () => {
    expect(clipText("ab\u{1F600}cd", 3)).toEqual({ text: "ab", cut: true });
    expect(clipText("ab\u{1F600}cd", 4)).toEqual({ text: "ab\u{1F600}", cut: true });
  });
});

describe("singleLine", () => {
  test("collapses whitespace and newlines", () => {
    expect(singleLine("  feat/a \n\t b  ")).toBe("feat/a b");
  });
});
