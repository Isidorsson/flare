import { describe, expect, test } from "bun:test";

import { isSamePath, parsePartialJson, valueAt, type JsonValue } from "./partial-json";

const SAMPLE: JsonValue = {
  file_path: "C:\\work\\a.ts",
  old_string: 'say "hi"\n\tnext',
  new_string: "caf\u00e9 \u{1f600} line1\nline2\\end",
  replace_all: false,
  edits: [
    { old_string: "a", new_string: "b" },
    { old_string: "c", new_string: "d" },
  ],
  count: 12,
  nothing: null,
};
const SAMPLE_TEXT = JSON.stringify(SAMPLE);

function valueOf(text: string): JsonValue | undefined {
  return parsePartialJson(text).value;
}

describe("parsePartialJson", () => {
  test("reads complete JSON exactly like JSON.parse", () => {
    expect(valueOf(SAMPLE_TEXT)).toEqual(SAMPLE);
    expect(parsePartialJson(SAMPLE_TEXT).openString).toBeNull();
  });

  test("keeps whatever is complete when the input stops anywhere", () => {
    expect(valueOf('{"a": 1, "b": "tw')).toEqual({ a: 1, b: "tw" });
    expect(valueOf('{"a": [1, 2')).toEqual({ a: [1, 2] });
    expect(valueOf('{"a": [{"b": "x"}, {"c"')).toEqual({ a: [{ b: "x" }, {}] });
    expect(valueOf('{"a": tr')).toEqual({});
    expect(valueOf('{"a": true')).toEqual({ a: true });
    expect(valueOf("")).toBeUndefined();
    expect(valueOf("  ")).toBeUndefined();
  });

  test("drops a dangling key, colon or comma", () => {
    expect(valueOf('{"a": 1, "b')).toEqual({ a: 1 });
    expect(valueOf('{"a": 1, "b"')).toEqual({ a: 1 });
    expect(valueOf('{"a": 1, "b":')).toEqual({ a: 1 });
    expect(valueOf('{"a": 1,')).toEqual({ a: 1 });
  });

  test("shows a number that is still growing at the end", () => {
    expect(valueOf('{"n": 12')).toEqual({ n: 12 });
    expect(valueOf('{"n": 12,')).toEqual({ n: 12 });
  });

  test("tolerates whitespace and pretty-printed input", () => {
    expect(valueOf(' {\n  "a" : [ 1 , 2 ] ,\n  "b" : "x"\n}')).toEqual({ a: [1, 2], b: "x" });
  });

  test("never throws on malformed input", () => {
    for (const text of ["}", "]", ",", ":", '{"a" 1}', '{"a": }', "[,1]", "nope", '{"a": @}']) {
      expect(() => parsePartialJson(text)).not.toThrow();
    }
  });

  test("tells which string was cut off by the end of the input", () => {
    expect(parsePartialJson('{"file_path": "a.ts", "old_string": "ab').openString).toEqual(["old_string"]);
    expect(parsePartialJson('{"edits": [{"new_string": "x').openString).toEqual(["edits", 0, "new_string"]);
    expect(parsePartialJson('{"file_path": "a.ts", "old_string": "ab"').openString).toBeNull();
    expect(parsePartialJson('{"file_path": "a.t').openString).toEqual(["file_path"]);
  });

  test("a key cut off mid-way is not reported as an open string", () => {
    expect(parsePartialJson('{"file_pa').openString).toBeNull();
  });
});

describe("escape sequences split mid-chunk", () => {
  test.each([
    ['{"s": "a\\', "a"],
    ['{"s": "a\\n', "a\n"],
    ['{"s": "a\\"', 'a"'],
    ['{"s": "a\\u', "a"],
    ['{"s": "a\\u00', "a"],
    ['{"s": "a\\u00e', "a"],
    ['{"s": "a\\u00e9', "a\u00e9"],
    ['{"s": "\\ud83d', ""],
    ['{"s": "\\ud83d\\ude', ""],
    ['{"s": "\\ud83d\\ude00', "\u{1f600}"],
    ['{"s": "tab\\t', "tab\t"],
    ['{"s": "slash\\\\', "slash\\"],
    ['{"s": "x\\/y', "x/y"],
  ])("%j shows %j", (text, expected) => {
    expect(valueAt(valueOf(text), ["s"])).toBe(expected);
  });
});

describe("every prefix of a tool input", () => {
  test("only ever shows text that the full input starts with", () => {
    for (let end = 0; end <= SAMPLE_TEXT.length; end += 1) {
      const prefix = valueOf(SAMPLE_TEXT.slice(0, end));
      for (const key of ["file_path", "old_string", "new_string"]) {
        const shown = valueAt(prefix, [key]);
        if (shown === undefined) continue;
        const full = valueAt(SAMPLE, [key]);
        expect(typeof shown === "string" && typeof full === "string" && full.startsWith(shown)).toBe(true);
      }
    }
  });

  test("grows monotonically for a string typed one character at a time", () => {
    const content = 'line one\nline "two"\u00e9\u{1f600}';
    const text = JSON.stringify({ content });
    let previous = "";
    for (let end = 1; end <= text.length; end += 1) {
      const shown = valueAt(valueOf(text.slice(0, end)), ["content"]);
      const current = typeof shown === "string" ? shown : "";
      expect(current.startsWith(previous)).toBe(true);
      previous = current;
    }
    expect(previous).toBe(content);
  });
});

describe("valueAt and isSamePath", () => {
  test("walks objects and arrays and gives undefined for anything missing", () => {
    expect(valueAt(SAMPLE, ["edits", 1, "new_string"])).toBe("d");
    expect(valueAt(SAMPLE, ["edits", 5])).toBeUndefined();
    expect(valueAt(SAMPLE, ["file_path", "x"])).toBeUndefined();
    expect(valueAt(SAMPLE, ["edits", "x"])).toBeUndefined();
    expect(valueAt(SAMPLE, ["constructor"])).toBeUndefined();
    expect(valueAt(undefined, [])).toBeUndefined();
  });

  test("compares key paths", () => {
    expect(isSamePath(["a", 0], ["a", 0])).toBe(true);
    expect(isSamePath(["a", 0], ["a", 1])).toBe(false);
    expect(isSamePath(["a"], ["a", 0])).toBe(false);
    expect(isSamePath(null, [])).toBe(false);
  });
});
