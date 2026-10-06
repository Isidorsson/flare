import { describe, expect, test } from "bun:test";

import { createThread, type ChatItem, type Thread } from "@/features/agent/thread-types";

import { turnContextFor } from "./turn-context";

function thread(items: ChatItem[]): Thread {
  return { ...createThread({ id: "thread-1", cwd: "C:/work", createdAt: 1 }), items };
}

const ITEMS: ChatItem[] = [
  { kind: "user", id: "item-0", text: "first" },
  { kind: "assistant", id: "item-1", text: "done", streaming: false },
  { kind: "user", id: "item-2", text: "second" },
];

describe("turnContextFor", () => {
  test("anchors the turn to the newest user message", () => {
    expect(turnContextFor(thread(ITEMS))).toEqual({
      ok: true,
      context: { threadId: "thread-1", sessionId: "thread-1", root: "C:/work", anchorItemId: "item-2" },
    });
  });

  test("scopes snapshots by the thread id, so a first message needs no Claude session id", () => {
    const result = turnContextFor({ ...thread(ITEMS), sessionId: null });
    expect(result.ok && result.context.sessionId).toBe("thread-1");
  });

  test("says so when no thread is running", () => {
    expect(turnContextFor(null)).toEqual({ ok: false, reason: "no thread is running" });
  });

  test("says so when the turn has no user message", () => {
    const items: ChatItem[] = [{ kind: "assistant", id: "item-1", text: "done", streaming: false }];
    expect(turnContextFor(thread(items))).toEqual({ ok: false, reason: "the turn has no user message" });
  });
});
