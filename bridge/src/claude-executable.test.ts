import { describe, expect, test } from "bun:test";

import { CLAUDE_PATH_ENV, resolveClaudeExecutable } from "./claude-executable";

describe("resolveClaudeExecutable", () => {
  test("uses the override from the environment first", () => {
    const path = resolveClaudeExecutable({ [CLAUDE_PATH_ENV]: "D:/tools/claude.exe" }, () => "C:/other/claude.exe");
    expect(path).toBe("D:/tools/claude.exe");
  });

  test("resolves claude from PATH", () => {
    expect(resolveClaudeExecutable({}, (command) => (command === "claude" ? "C:/bin/claude.exe" : null))).toBe(
      "C:/bin/claude.exe",
    );
  });

  test("ignores an empty override", () => {
    expect(resolveClaudeExecutable({ [CLAUDE_PATH_ENV]: "" }, () => "C:/bin/claude.exe")).toBe("C:/bin/claude.exe");
  });

  test("fails with an actionable message when claude is not installed", () => {
    expect(() => resolveClaudeExecutable({}, () => null)).toThrow(CLAUDE_PATH_ENV);
  });

  test("rejects npm style .cmd shims that cannot be spawned directly", () => {
    expect(() => resolveClaudeExecutable({}, () => "C:/Users/me/AppData/Roaming/npm/claude.cmd")).toThrow("shim");
  });
});
