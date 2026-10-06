import { describe, expect, test } from "bun:test";

import { countLines, diffLines, replacedSpan, withLineBreaks, type TextEdit } from "./line-diff";

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.offset - a.offset)
    .reduce((current, edit) => current.slice(0, edit.offset) + edit.text + current.slice(edit.offset + edit.length), text);
}

function lines(...parts: string[]): string {
  return parts.map((part) => `${part}\n`).join("");
}

function shape(before: string, after: string) {
  return diffLines(before, after).map(({ oldStart, oldCount, newStart, newCount }) => ({
    oldStart,
    oldCount,
    newStart,
    newCount,
  }));
}

describe("diffLines", () => {
  test("finds no hunks for equal texts", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([]);
    expect(diffLines("", "")).toEqual([]);
  });

  test("reports a replaced line with the text that was removed", () => {
    const hunks = diffLines(lines("a", "b", "c"), lines("a", "B", "c"));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, removed: ["b"] });
  });

  test("reports inserted lines with no removed text", () => {
    const hunks = diffLines(lines("a", "c"), lines("a", "b1", "b2", "c"));
    expect(hunks).toMatchObject([{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 2, removed: [] }]);
  });

  test("reports removed lines, pointing at the line that now follows them", () => {
    const hunks = diffLines(lines("a", "x", "y", "c"), lines("a", "c"));
    expect(hunks).toMatchObject([{ oldStart: 2, oldCount: 2, newStart: 2, newCount: 0, removed: ["x", "y"] }]);
  });

  test("splits separate changes into separate hunks", () => {
    expect(shape(lines("a", "b", "c", "d", "e"), lines("A", "b", "c", "d", "E"))).toEqual([
      { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
      { oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 },
    ]);
  });

  test("treats a created file as one hunk of added lines", () => {
    expect(shape("", lines("a", "b", "c"))).toEqual([{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 3 }]);
  });

  test("treats an emptied file as one hunk of removed lines", () => {
    expect(shape(lines("a", "b"), "")).toEqual([{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 0 }]);
  });

  test("shifts later hunks by the lines earlier ones added", () => {
    expect(shape(lines("a", "b", "c", "d"), lines("a", "new", "b", "c", "D"))).toEqual([
      { oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 },
      { oldStart: 4, oldCount: 1, newStart: 5, newCount: 1 },
    ]);
  });

  test("picks up a change to the final line break", () => {
    expect(shape("a\nb", "a\nb\nc")).toEqual([{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 2 }]);
  });

  test("tells CRLF from LF", () => {
    expect(shape("a\r\nb\r\n", "a\nb\n")).toEqual([{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 2 }]);
  });

  test("handles texts that differ everywhere", () => {
    const before = Array.from({ length: 30 }, (_, index) => `old ${String(index)}`).join("\n");
    const after = Array.from({ length: 25 }, (_, index) => `new ${String(index)}`).join("\n");
    const hunks = diffLines(before, after);
    expect(hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0)).toBe(30);
    expect(hunks.reduce((sum, hunk) => sum + hunk.newCount, 0)).toBe(25);
  });

  test("falls back to one hunk for a huge rewrite instead of working forever", () => {
    const before = Array.from({ length: 1200 }, (_, index) => `a${String(index)}\n`).join("");
    const after = Array.from({ length: 1200 }, (_, index) => `b${String(index)}\n`).join("");
    expect(shape(before, after)).toEqual([{ oldStart: 1, oldCount: 1200, newStart: 1, newCount: 1200 }]);
  });
});

describe("hunk edits", () => {
  const cases: [string, string, string][] = [
    ["a replaced line", lines("a", "b", "c"), lines("a", "B", "c")],
    ["an insertion at the end", "a\nb", "a\nb\nc"],
    ["an insertion at the start", lines("b"), lines("a", "b")],
    ["a removal at the end", lines("a", "b"), lines("a")],
    ["two separate changes", lines("a", "b", "c", "d", "e", "f"), lines("A", "b", "c", "d", "e", "F", "g")],
    ["CRLF text", "a\r\nb\r\nc\r\n", "a\r\nX\r\nc\r\nd\r\n"],
    ["an empty before", "", "hello"],
    ["an empty after", "hello\nworld", ""],
    ["a missing final newline", "a\nb\n", "a\nb"],
  ];

  test.each(cases)("turn the old text into the new one for %s", (_name, before, after) => {
    const edits = diffLines(before, after).map((hunk) => hunk.edit);
    expect(applyEdits(before, edits)).toBe(after);
  });

  test("hold character offsets of exactly the changed lines", () => {
    const [hunk] = diffLines(lines("one", "two", "three"), lines("one", "2", "three"));
    expect(hunk?.edit).toEqual({ offset: 4, length: 4, text: "2\n" });
  });
});

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomLines(random: () => number, prefix: string, max: number): string[] {
  return Array.from({ length: Math.floor(random() * max) }, () => `${prefix}${String(Math.floor(random() * 6))}\n`);
}

describe("diffLines on random edits", () => {
  test("always yields hunks whose edits rebuild the new text and whose counts add up", () => {
    const random = pseudoRandom(7);
    for (let round = 0; round < 200; round += 1) {
      const before = randomLines(random, "l", 25);
      const after = [...before];
      for (let change = 0; change < Math.floor(random() * 5); change += 1) {
        after.splice(Math.floor(random() * (after.length + 1)), Math.floor(random() * 3), ...randomLines(random, "n", 3));
      }
      const hunks = diffLines(before.join(""), after.join(""));
      expect(applyEdits(before.join(""), hunks.map((hunk) => hunk.edit))).toBe(after.join(""));
      const removed = hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0);
      const added = hunks.reduce((sum, hunk) => sum + hunk.newCount, 0);
      expect(added - removed).toBe(after.length - before.length);
    }
  });
});

describe("withLineBreaks", () => {
  test("makes every line break the same", () => {
    expect(withLineBreaks("a\nb\r\nc\rd", "\r\n")).toBe("a\r\nb\r\nc\r\nd");
    expect(withLineBreaks("a\r\nb", "\n")).toBe("a\nb");
    expect(withLineBreaks("none", "\n")).toBe("none");
  });
});

describe("countLines", () => {
  test.each([
    ["", 0],
    ["a", 1],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\r\nb\r\n", 2],
    ["\n\n", 2],
  ])("counts the lines of %j", (text, count) => {
    expect(countLines(text)).toBe(count);
  });
});

describe("replacedSpan", () => {
  test("is null for equal texts", () => {
    expect(replacedSpan("same", "same")).toBeNull();
  });

  test.each([
    ["appending", "abc", "abcdef", { offset: 3, length: 0, text: "def" }],
    ["inserting in the middle", "abef", "abcdef", { offset: 2, length: 0, text: "cd" }],
    ["replacing in the middle", "abXef", "abcdef", { offset: 2, length: 1, text: "cd" }],
    ["deleting", "abcdef", "abef", { offset: 2, length: 2, text: "" }],
    ["starting from nothing", "", "abc", { offset: 0, length: 0, text: "abc" }],
    ["clearing", "abc", "", { offset: 0, length: 3, text: "" }],
    ["a change inside repeated text", "aaaa", "aaaaa", { offset: 4, length: 0, text: "a" }],
  ])("finds the edit for %s", (_name, before, after, edit) => {
    expect(replacedSpan(before, after)).toEqual(edit);
    expect(applyEdits(before, [edit])).toBe(after);
  });
});
