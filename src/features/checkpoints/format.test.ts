import { describe, expect, test } from "bun:test";

import { formatClock, oneLine } from "./format";

describe("oneLine", () => {
  test("collapses whitespace and line breaks", () => {
    expect(oneLine("  fix the\n\n  login   bug \t now ")).toBe("fix the login bug now");
  });

  test("keeps short text as it is", () => {
    expect(oneLine("short")).toBe("short");
  });

  test("cuts long text with an ellipsis within the limit", () => {
    const cut = oneLine("x".repeat(200), 20);
    expect(cut).toBe(`${"x".repeat(19)}…`);
    expect(cut).toHaveLength(20);
  });
});

describe("formatClock", () => {
  test("shows hours and minutes of the given moment", () => {
    const moment = new Date(2026, 9, 6, 14, 5, 59).getTime();
    expect(formatClock(moment)).toContain(":05");
  });
});
