import { describe, expect, test } from "bun:test";

import { bridgeEventSchema } from "./bridge-events";

const usage = { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 5 };

const validEvents: Record<string, object> = {
  "session.ready": { type: "session.ready", sessionId: "abc" },
  "assistant.delta": { type: "assistant.delta", text: "Hel" },
  "assistant.delta with empty text": { type: "assistant.delta", text: "" },
  "assistant.message": { type: "assistant.message", id: "m1", text: "Hello" },
  "tool.started": { type: "tool.started", toolUseId: "t1", name: "Read", input: { file_path: "a.ts" } },
  "tool.started with empty input": { type: "tool.started", toolUseId: "t1", name: "Bash", input: {} },
  "tool.finished": { type: "tool.finished", toolUseId: "t1", isError: false, summary: "ok" },
  "file.read": { type: "file.read", toolUseId: "t1", path: "C:/work/a.ts" },
  "file.change update": {
    type: "file.change",
    toolUseId: "t2",
    path: "C:/work/a.ts",
    kind: "update",
    before: "a",
    after: "b",
  },
  "file.change create": {
    type: "file.change",
    toolUseId: "t2",
    path: "C:/work/new.ts",
    kind: "create",
    before: null,
    after: "b",
  },
  "permission.request": { type: "permission.request", requestId: "r1", toolName: "Bash", input: { command: "ls" } },
  "turn.completed": { type: "turn.completed", costUsd: 0.0123, usage },
  error: { type: "error", message: "boom" },
  "error fatal": { type: "error", message: "bridge exited", fatal: true },
};

const invalidEvents: Record<string, unknown> = {
  "unknown type": { type: "session.closed" },
  "missing type": { text: "hi" },
  "session.ready with empty id": { type: "session.ready", sessionId: "" },
  "assistant.delta without text": { type: "assistant.delta" },
  "assistant.message without id": { type: "assistant.message", text: "x" },
  "tool.started with array input": { type: "tool.started", toolUseId: "t1", name: "Read", input: [] },
  "tool.started without name": { type: "tool.started", toolUseId: "t1", input: {} },
  "tool.finished with string isError": { type: "tool.finished", toolUseId: "t1", isError: "no", summary: "" },
  "file.read without path": { type: "file.read", toolUseId: "t1" },
  "file.change with unknown kind": {
    type: "file.change",
    toolUseId: "t2",
    path: "a",
    kind: "delete",
    before: "a",
    after: "b",
  },
  "file.change with missing before": { type: "file.change", toolUseId: "t2", path: "a", kind: "update", after: "b" },
  "file.change with null after": {
    type: "file.change",
    toolUseId: "t2",
    path: "a",
    kind: "update",
    before: "a",
    after: null,
  },
  "permission.request without input": { type: "permission.request", requestId: "r1", toolName: "Bash" },
  "turn.completed with negative cost": { type: "turn.completed", costUsd: -1, usage },
  "turn.completed with fractional tokens": {
    type: "turn.completed",
    costUsd: 0,
    usage: { ...usage, inputTokens: 1.5 },
  },
  "turn.completed without usage": { type: "turn.completed", costUsd: 0 },
  "error with non-string message": { type: "error", message: 5 },
  "error with non-boolean fatal": { type: "error", message: "x", fatal: "yes" },
};

describe("bridgeEventSchema", () => {
  test.each(Object.entries(validEvents))("accepts %s", (_name, event) => {
    expect(bridgeEventSchema.parse(event)).toMatchObject(event);
  });

  test.each(Object.entries(invalidEvents))("rejects %s", (_name, event) => {
    expect(bridgeEventSchema.safeParse(event).success).toBe(false);
  });

  test("covers every event type in the plan", () => {
    const types = new Set(Object.values(validEvents).map((event) => bridgeEventSchema.parse(event).type));
    expect(types).toEqual(
      new Set([
        "session.ready",
        "assistant.delta",
        "assistant.message",
        "tool.started",
        "tool.finished",
        "file.read",
        "file.change",
        "permission.request",
        "turn.completed",
        "error",
      ]),
    );
  });
});
