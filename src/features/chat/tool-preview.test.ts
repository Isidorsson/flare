import { describe, expect, test } from "bun:test";

import { formatToolInput, PREVIEW_MAX_CHARS, previewToolInput, primaryInputText } from "./tool-preview";

describe("primaryInputText", () => {
  test("returns the full, untruncated text of the most telling field", () => {
    const script = `set -e\n${"echo hi\n".repeat(100)}`;
    expect(primaryInputText({ command: script, description: "x" })).toBe(script.trim());
  });

  test("falls back to the plan for plan approvals and to null for unknown shapes", () => {
    expect(primaryInputText({ plan: "1. do it" })).toBe("1. do it");
    expect(primaryInputText({ foo: "bar" })).toBeNull();
  });
});

describe("previewToolInput", () => {
  test("prefers the command, then file paths, then patterns", () => {
    expect(previewToolInput({ command: "ls -la", description: "list" })).toBe("ls -la");
    expect(previewToolInput({ file_path: "src/a.ts", old_string: "x" })).toBe("src/a.ts");
    expect(previewToolInput({ pattern: "TODO", glob: "*.ts" })).toBe("TODO");
  });

  test("collapses whitespace and truncates long values", () => {
    expect(previewToolInput({ command: "echo   one\n  two" })).toBe("echo one two");
    const preview = previewToolInput({ command: "x".repeat(500) });
    expect(preview).toHaveLength(PREVIEW_MAX_CHARS);
    expect(preview.endsWith("…")).toBe(true);
  });

  test("is empty when nothing readable is present", () => {
    expect(previewToolInput({})).toBe("");
    expect(previewToolInput({ command: 5, file_path: "   " })).toBe("");
  });
});

describe("formatToolInput", () => {
  test("pretty prints the input", () => {
    expect(formatToolInput({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
