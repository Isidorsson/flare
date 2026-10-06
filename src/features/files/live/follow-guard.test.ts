import { describe, expect, test } from "bun:test";

import { NO_USER_ACTIVITY, userHoldsEditor, userIsTyping } from "./follow-guard";

describe("userHoldsEditor", () => {
  const now = 100_000;

  test("lets the agent follow when the user has done nothing", () => {
    expect(userHoldsEditor(NO_USER_ACTIVITY, now)).toBe(false);
  });

  test("holds the editor for six seconds after the user typed", () => {
    expect(userHoldsEditor({ typedAt: now - 5_999, pickedAt: null }, now)).toBe(true);
    expect(userHoldsEditor({ typedAt: now - 6_000, pickedAt: null }, now)).toBe(false);
  });

  test("holds the editor for twelve seconds after the user picked a file", () => {
    expect(userHoldsEditor({ typedAt: null, pickedAt: now - 11_999 }, now)).toBe(true);
    expect(userHoldsEditor({ typedAt: null, pickedAt: now - 12_000 }, now)).toBe(false);
  });

  test("a recent pick still holds after the typing window has passed", () => {
    expect(userHoldsEditor({ typedAt: now - 8_000, pickedAt: now - 8_000 }, now)).toBe(true);
  });
});

describe("userIsTyping", () => {
  const now = 100_000;

  test("is true for six seconds after the user typed, and ignores picking a file", () => {
    expect(userIsTyping({ typedAt: now - 5_999, pickedAt: null }, now)).toBe(true);
    expect(userIsTyping({ typedAt: now - 6_000, pickedAt: null }, now)).toBe(false);
    expect(userIsTyping({ typedAt: null, pickedAt: now - 1_000 }, now)).toBe(false);
    expect(userIsTyping(NO_USER_ACTIVITY, now)).toBe(false);
  });
});
