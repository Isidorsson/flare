import { describe, expect, test } from "bun:test";

import type { AppMessage } from "./app-messages";
import type { BridgeEvent } from "./bridge-events";
import { encodeLine, parseAppMessage, parseBridgeEvent, ProtocolError, splitLines } from "./ndjson";

describe("encodeLine", () => {
  test("emits a single JSON line terminated by a newline", () => {
    const line = encodeLine({ type: "user.message", text: "line one\nline two" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
  });

  test("round trips through the parsers", () => {
    const message = { type: "user.message", text: "line one\nline two" } as const;
    expect(parseAppMessage(encodeLine(message).trim())).toEqual(message);

    const event = { type: "assistant.delta", text: "a\r\nb c" } as const;
    expect(parseBridgeEvent(encodeLine(event).trim())).toEqual(event);
  });

  test("keeps a multi line diff on a single line and round trips commit messages", () => {
    const request: AppMessage = {
      type: "commit.generate",
      requestId: "c1",
      stat: " a.ts | 1 +",
      patch: "diff --git a/a.ts b/a.ts\r\n+line\n",
      truncated: false,
      recentSubjects: ["fix: x"],
      includeBody: true,
    };
    const line = encodeLine(request);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(parseAppMessage(line.trim())).toEqual(request);

    const generated: BridgeEvent = { type: "commit.generated", requestId: "c1", subject: "fix: x", body: "why\n\nmore" };
    expect(parseBridgeEvent(encodeLine(generated).trim())).toEqual(generated);
  });
});

describe("parseAppMessage", () => {
  test("returns the typed message", () => {
    expect(parseAppMessage('{"type":"interrupt"}')).toEqual({ type: "interrupt" });
  });

  test("throws a ProtocolError for invalid JSON", () => {
    expect(() => parseAppMessage("{nope")).toThrow(ProtocolError);
  });

  test("throws a ProtocolError that names the problem for schema violations", () => {
    expect(() => parseAppMessage('{"type":"user.message","text":""}')).toThrow(/text/);
  });

  test("rejects bridge events", () => {
    expect(() => parseAppMessage('{"type":"assistant.delta","text":"x"}')).toThrow(ProtocolError);
  });

  test("truncates long lines in the error message", () => {
    const line = `{"type":"user.message","text":${JSON.stringify("x".repeat(1000))},"junk":`;
    try {
      parseAppMessage(line);
      throw new Error("expected parseAppMessage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect(error instanceof Error && error.message.length < 400).toBe(true);
    }
  });
});

describe("parseBridgeEvent", () => {
  test("returns the typed event", () => {
    expect(parseBridgeEvent('{"type":"session.ready","sessionId":"s1"}')).toEqual({
      type: "session.ready",
      sessionId: "s1",
    });
  });

  test("throws a ProtocolError for unknown events", () => {
    expect(() => parseBridgeEvent('{"type":"nope"}')).toThrow(ProtocolError);
  });

  test("keeps the underlying parse failure as the cause", () => {
    try {
      parseBridgeEvent("not json");
      throw new Error("expected parseBridgeEvent to throw");
    } catch (error) {
      expect(error instanceof Error && error.cause instanceof SyntaxError).toBe(true);
    }
  });
});

describe("splitLines", () => {
  test("returns complete lines and keeps the partial remainder", () => {
    expect(splitLines("", 'a\nb\nc')).toEqual({ lines: ["a", "b"], rest: "c" });
  });

  test("joins a partial line with the next chunk", () => {
    const first = splitLines("", '{"type":"inter');
    expect(first).toEqual({ lines: [], rest: '{"type":"inter' });
    const second = splitLines(first.rest, 'rupt"}\n');
    expect(second).toEqual({ lines: ['{"type":"interrupt"}'], rest: "" });
  });

  test("strips carriage returns and skips blank lines", () => {
    expect(splitLines("", "a\r\n\r\n\nb\r\n")).toEqual({ lines: ["a", "b"], rest: "" });
  });

  test("handles an empty chunk", () => {
    expect(splitLines("pending", "")).toEqual({ lines: [], rest: "pending" });
  });
});
