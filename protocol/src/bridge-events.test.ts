import { describe, expect, test } from "bun:test";

import { bridgeEventSchema } from "./bridge-events";
import { MAX_EDITING_TEXT_CHARS, MAX_MATCH_LINES } from "./constants";

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
  "file.read with a range": {
    type: "file.read",
    toolUseId: "t1",
    path: "C:/work/a.ts",
    range: { start: 10, end: 40 },
  },
  "file.read with a single-line range": {
    type: "file.read",
    toolUseId: "t1",
    path: "C:/work/a.ts",
    range: { start: 7, end: 7 },
  },
  "file.read from a single-file search": {
    type: "file.read",
    toolUseId: "t1",
    path: "C:/work/a.ts",
    pattern: "useEffect",
    matchLines: [3, 18, 42],
  },
  "file.read from a search without matches": {
    type: "file.read",
    toolUseId: "t1",
    path: "C:/work/a.ts",
    pattern: "nothing",
    matchLines: [],
  },
  "file.editing an edit": {
    type: "file.editing",
    toolUseId: "t3",
    path: "C:/work/a.ts",
    kind: "edit",
    oldString: "const a = 1;",
    text: "const a = 2",
  },
  "file.editing an edit with nothing typed yet": {
    type: "file.editing",
    toolUseId: "t3",
    path: "C:/work/a.ts",
    kind: "edit",
    oldString: "const a = 1;",
    text: "",
  },
  "file.editing a write": { type: "file.editing", toolUseId: "t3", path: "C:/work/new.ts", kind: "write", text: "x" },
  "turn.started": { type: "turn.started" },
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
  "file.read with a zero start": { type: "file.read", toolUseId: "t1", path: "a", range: { start: 0, end: 3 } },
  "file.read with a fractional line": { type: "file.read", toolUseId: "t1", path: "a", range: { start: 1.5, end: 3 } },
  "file.read with an inverted range": { type: "file.read", toolUseId: "t1", path: "a", range: { start: 9, end: 3 } },
  "file.read with a range missing its end": { type: "file.read", toolUseId: "t1", path: "a", range: { start: 3 } },
  "file.read with matchLines but no pattern": { type: "file.read", toolUseId: "t1", path: "a", matchLines: [1] },
  "file.read with an empty pattern": { type: "file.read", toolUseId: "t1", path: "a", pattern: "", matchLines: [1] },
  "file.read with a range and a pattern": {
    type: "file.read",
    toolUseId: "t1",
    path: "a",
    range: { start: 1, end: 2 },
    pattern: "x",
  },
  "file.read with a non-positive match line": {
    type: "file.read",
    toolUseId: "t1",
    path: "a",
    pattern: "x",
    matchLines: [0],
  },
  "file.read with too many match lines": {
    type: "file.read",
    toolUseId: "t1",
    path: "a",
    pattern: "x",
    matchLines: Array.from({ length: MAX_MATCH_LINES + 1 }, (_, index) => index + 1),
  },
  "file.editing without text": { type: "file.editing", toolUseId: "t3", path: "a", kind: "edit" },
  "file.editing with an unknown kind": { type: "file.editing", toolUseId: "t3", path: "a", kind: "delete", text: "" },
  "file.editing with an empty path": { type: "file.editing", toolUseId: "t3", path: "", kind: "write", text: "" },
  "file.editing a write with an oldString": {
    type: "file.editing",
    toolUseId: "t3",
    path: "a",
    kind: "write",
    oldString: "x",
    text: "y",
  },
  "file.editing with oversized text": {
    type: "file.editing",
    toolUseId: "t3",
    path: "a",
    kind: "write",
    text: "x".repeat(MAX_EDITING_TEXT_CHARS + 1),
  },
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
        "file.editing",
        "file.change",
        "permission.request",
        "turn.started",
        "turn.completed",
        "error",
      ]),
    );
  });
});
