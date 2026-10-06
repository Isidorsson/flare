import { describe, expect, test } from "bun:test";

import { CONCISE_INSTRUCTION, responseStyleOptions } from "./response-style";

describe("responseStyleOptions", () => {
  test("concise appends the instruction to the Claude Code preset", () => {
    expect(responseStyleOptions("concise")).toEqual({
      systemPrompt: { type: "preset", preset: "claude_code", append: CONCISE_INSTRUCTION },
    });
  });

  test("default keeps the plain preset and leaves settings alone", () => {
    expect(responseStyleOptions("default")).toEqual({ systemPrompt: { type: "preset", preset: "claude_code" } });
  });

  test("explanatory selects the built-in output style", () => {
    expect(responseStyleOptions("explanatory")).toEqual({
      systemPrompt: { type: "preset", preset: "claude_code" },
      settings: { outputStyle: "Explanatory" },
    });
  });
});
