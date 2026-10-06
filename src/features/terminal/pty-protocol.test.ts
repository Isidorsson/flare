import { describe, expect, test } from "bun:test";

import { describeExit, parsePtyMessage } from "./pty-protocol";

describe("pty channel messages", () => {
  test("decodes a raw frame into output bytes", () => {
    const frame = new Uint8Array([104, 105, 27, 91, 109]).buffer;

    const message = parsePtyMessage(frame);

    expect(message.kind).toBe("output");
    if (message.kind === "output") expect([...message.bytes]).toEqual([104, 105, 27, 91, 109]);
  });

  test("accepts an empty frame", () => {
    const message = parsePtyMessage(new ArrayBuffer(0));
    expect(message.kind === "output" && message.bytes.length === 0).toBe(true);
  });

  test("decodes an exit event with a code", () => {
    expect(parsePtyMessage({ type: "exit", code: 7 })).toEqual({ kind: "exit", code: 7 });
  });

  test("decodes an exit event with an unknown code", () => {
    expect(parsePtyMessage({ type: "exit", code: null })).toEqual({ kind: "exit", code: null });
  });

  test("matches the JSON the Rust side sends", () => {
    const wire: unknown = JSON.parse('{"type":"exit","code":0}');
    expect(parsePtyMessage(wire)).toEqual({ kind: "exit", code: 0 });
  });

  test("rejects anything else", () => {
    for (const bad of [
      "output",
      42,
      null,
      undefined,
      [1, 2, 3],
      { type: "exit" },
      { type: "exit", code: -1 },
      { type: "exit", code: 1.5 },
      { type: "output", data: "x" },
    ]) {
      expect(() => parsePtyMessage(bad)).toThrow();
    }
  });

  test("describes exits for humans", () => {
    expect(describeExit(0)).toBe("process exited with code 0");
    expect(describeExit(null)).toBe("process exited");
  });
});
