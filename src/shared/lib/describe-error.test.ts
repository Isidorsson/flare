import { describe, expect, test } from "bun:test";

import { describeError } from "./describe-error";

describe("describeError", () => {
  test("uses the message of an Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  test("passes strings through, which is how Tauri reports command errors", () => {
    expect(describeError("the agent bridge is not running")).toBe("the agent bridge is not running");
  });

  test("serialises anything else", () => {
    expect(describeError({ code: 7 })).toBe('{"code":7}');
    expect(describeError(undefined)).toBe("undefined");
  });
});
