import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { COPY_FEEDBACK_MS, copyLabel, copyToClipboard, copyTransition } from "./copy-machine";

describe("copyTransition", () => {
  test("a copy shows its outcome, and the outcome clears on reset", () => {
    expect(copyTransition("idle", "copied")).toBe("copied");
    expect(copyTransition("idle", "failed")).toBe("failed");
    expect(copyTransition("copied", "reset")).toBe("idle");
    expect(copyTransition("failed", "reset")).toBe("idle");
  });

  test("a second copy while the first is showing keeps showing the latest outcome", () => {
    expect(copyTransition("copied", "failed")).toBe("failed");
    expect(copyTransition("failed", "copied")).toBe("copied");
  });

  test("the outcome stays on screen for a moment, not forever", () => {
    expect(COPY_FEEDBACK_MS).toBeGreaterThan(0);
    expect(COPY_FEEDBACK_MS).toBeLessThan(5000);
  });
});

describe("copyLabel", () => {
  test("tells the user what pressing the button does, and then what happened", () => {
    expect(copyLabel("idle")).toBe("Copy code");
    expect(copyLabel("copied")).toBe("Copied");
    expect(copyLabel("failed")).toBe("Could not copy");
  });
});

describe("copyToClipboard", () => {
  afterEach(() => {
    mock.restore();
  });

  const silencedErrors = () => spyOn(console, "error").mockImplementation(() => undefined);

  test("writes exactly the text it was given, even multi-line code", async () => {
    const errors = silencedErrors();
    const written: string[] = [];
    const code = "const a = 1;\n\n  indented();\n";
    const outcome = await copyToClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    }, code);
    expect(outcome).toBe("copied");
    expect(written).toEqual([code]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("a refused write is reported as failed and logged, not thrown", async () => {
    const errors = silencedErrors();
    const outcome = await copyToClipboard(() => Promise.reject(new Error("denied")), "x");
    expect(outcome).toBe("failed");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  test("a clipboard that is missing altogether counts as a failed write", async () => {
    const errors = silencedErrors();
    const outcome = await copyToClipboard(() => {
      throw new TypeError("clipboard is undefined");
    }, "x");
    expect(outcome).toBe("failed");
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
