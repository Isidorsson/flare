import { describe, expect, test } from "bun:test";

import { classifyKey, type KeyChord } from "./terminal-keys";

const chord = (overrides: Partial<KeyChord>): KeyChord => ({
  code: "KeyC",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

describe("terminal key classification", () => {
  test("Ctrl+C is an interrupt without a selection", () => {
    expect(classifyKey(chord({ ctrlKey: true }), false)).toBe("none");
  });

  test("Ctrl+C copies while text is selected", () => {
    expect(classifyKey(chord({ ctrlKey: true }), true)).toBe("copy");
  });

  test("Ctrl+Shift+C always copies", () => {
    expect(classifyKey(chord({ ctrlKey: true, shiftKey: true }), false)).toBe("copy");
    expect(classifyKey(chord({ ctrlKey: true, shiftKey: true }), true)).toBe("copy");
  });

  test("leaves paste to the browser", () => {
    expect(classifyKey(chord({ code: "KeyV", ctrlKey: true }), true)).toBe("none");
    expect(classifyKey(chord({ code: "KeyV", ctrlKey: true, shiftKey: true }), false)).toBe("none");
  });

  test("ignores plain typing and other modifier combinations", () => {
    expect(classifyKey(chord({}), true)).toBe("none");
    expect(classifyKey(chord({ ctrlKey: true, altKey: true }), true)).toBe("none");
    expect(classifyKey(chord({ ctrlKey: true, metaKey: true }), true)).toBe("none");
    expect(classifyKey(chord({ code: "KeyX", ctrlKey: true }), true)).toBe("none");
  });
});
