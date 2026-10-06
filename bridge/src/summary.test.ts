import { describe, expect, test } from "bun:test";

import { MAX_SUMMARY_CHARS, summarizeToolResult } from "./summary";

describe("summarizeToolResult", () => {
  test("returns plain string content trimmed", () => {
    expect(summarizeToolResult("  done\n")).toBe("done");
  });

  test("joins text blocks and labels non text blocks", () => {
    expect(summarizeToolResult([{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "two" }])).toBe(
      "one\n[image]\ntwo",
    );
  });

  test("returns an empty summary when there is no content", () => {
    expect(summarizeToolResult(undefined)).toBe("");
    expect(summarizeToolResult([])).toBe("");
  });

  test("truncates content beyond the limit and says how much was cut", () => {
    const summary = summarizeToolResult("y".repeat(MAX_SUMMARY_CHARS + 3));
    expect(summary.startsWith("y".repeat(MAX_SUMMARY_CHARS))).toBe(true);
    expect(summary.endsWith("(3 more characters)")).toBe(true);
  });

  test("keeps content exactly at the limit intact", () => {
    const text = "z".repeat(MAX_SUMMARY_CHARS);
    expect(summarizeToolResult(text)).toBe(text);
  });
});
