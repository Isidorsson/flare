import { describe, expect, test } from "bun:test";

import type { BridgeEvent } from "@flare/protocol";

import { createThread, type Thread } from "./thread-types";
import { addNotice, addUserMessage, applyBridgeEvent, markPermission, stopRunning, TITLE_MAX_CHARS } from "./transcript";

const usage = { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 };

function fresh(): Thread {
  return createThread({ id: "thread-1", cwd: "C:/work", createdAt: 0 });
}

function replay(events: BridgeEvent[], start: Thread = fresh()): Thread {
  return events.reduce(applyBridgeEvent, start);
}

describe("user messages", () => {
  test("adds the message, marks the thread running and derives the title once", () => {
    const first = addUserMessage(fresh(), "  Fix the\nlogin bug ");
    const second = addUserMessage(first, "Another message");

    expect(first.items).toEqual([{ kind: "user", id: "item-0", text: "  Fix the\nlogin bug " }]);
    expect(first.status).toBe("running");
    expect(second.title).toBe("Fix the login bug");
  });

  test("truncates long titles", () => {
    const thread = addUserMessage(fresh(), "x".repeat(200));
    expect(thread.title).toHaveLength(TITLE_MAX_CHARS);
    expect(thread.title.endsWith("…")).toBe(true);
  });
});

describe("assistant text", () => {
  test("accumulates deltas into one streaming item", () => {
    const thread = replay([
      { type: "assistant.delta", text: "Hel" },
      { type: "assistant.delta", text: "lo" },
    ]);
    expect(thread.items).toEqual([{ kind: "assistant", id: "item-0", text: "Hello", streaming: true }]);
  });

  test("replaces the streamed text with the final message and keeps the item identity", () => {
    const thread = replay([
      { type: "assistant.delta", text: "Hel" },
      { type: "assistant.message", id: "m1", text: "Hello!" },
    ]);
    expect(thread.items).toEqual([{ kind: "assistant", id: "item-0", text: "Hello!", streaming: false }]);
  });

  test("adds a finished message when nothing was streamed", () => {
    const thread = replay([{ type: "assistant.message", id: "m1", text: "Hello" }]);
    expect(thread.items).toEqual([{ kind: "assistant", id: "m1", text: "Hello", streaming: false }]);
  });

  test("starts a new item for text after a finished one", () => {
    const thread = replay([
      { type: "assistant.delta", text: "one" },
      { type: "assistant.message", id: "m1", text: "one" },
      { type: "assistant.delta", text: "two" },
    ]);
    expect(thread.items.map((item) => item.kind === "assistant" && item.text)).toEqual(["one", "two"]);
  });
});

describe("tools", () => {
  const started: BridgeEvent = { type: "tool.started", toolUseId: "t1", name: "Edit", input: { file_path: "a.ts" } };

  test("tracks a tool from started to finished", () => {
    const running = replay([started]);
    expect(running.items[0]).toMatchObject({ kind: "tool", id: "t1", status: "running", summary: "" });

    const done = applyBridgeEvent(running, { type: "tool.finished", toolUseId: "t1", isError: false, summary: "ok" });
    expect(done.items[0]).toMatchObject({ status: "done", summary: "ok" });

    const failed = applyBridgeEvent(running, { type: "tool.finished", toolUseId: "t1", isError: true, summary: "nope" });
    expect(failed.items[0]).toMatchObject({ status: "error", summary: "nope" });
  });

  test("records touched files once per action", () => {
    const thread = replay([
      started,
      { type: "file.read", toolUseId: "t1", path: "a.ts" },
      { type: "file.read", toolUseId: "t1", path: "a.ts" },
      { type: "file.change", toolUseId: "t1", path: "a.ts", kind: "update", before: "a", after: "b" },
    ]);
    expect(thread.items[0]).toMatchObject({
      touched: [
        { path: "a.ts", action: "read" },
        { path: "a.ts", action: "update" },
      ],
    });
  });

  test("ignores events for unknown tool uses", () => {
    const thread = replay([{ type: "tool.finished", toolUseId: "ghost", isError: false, summary: "" }]);
    expect(thread.items).toEqual([]);
  });

  test("stops streaming the preceding assistant text when a tool starts", () => {
    const thread = replay([{ type: "assistant.delta", text: "Let me look" }, started]);
    expect(thread.items[0]).toMatchObject({ kind: "assistant", streaming: false });
  });
});

describe("standalone replies", () => {
  test("leave the thread untouched", () => {
    const thread = replay([{ type: "assistant.delta", text: "Hi" }]);
    const next = replay(
      [
        { type: "commit.generated", requestId: "c1", subject: "fix: x", body: null },
        { type: "commit.failed", requestId: "c2", message: "nope" },
      ],
      thread,
    );
    expect(next).toBe(thread);
  });
});

describe("permissions", () => {
  const request: BridgeEvent = { type: "permission.request", requestId: "r1", toolName: "Bash", input: { command: "ls" } };

  test("adds a pending request and records the decision", () => {
    const pending = replay([request]);
    expect(pending.items[0]).toMatchObject({ kind: "permission", id: "r1", status: "pending" });
    expect(markPermission(pending, "r1", "allowSession").items[0]).toMatchObject({ status: "allowSession" });
  });

  test("does not overwrite an earlier decision or touch other requests", () => {
    const answered = markPermission(replay([request]), "r1", "deny");
    expect(markPermission(answered, "r1", "allow").items[0]).toMatchObject({ status: "deny" });
    expect(markPermission(answered, "other", "allow")).toEqual(answered);
  });
});

describe("turn lifecycle", () => {
  test("session.ready records the session id", () => {
    expect(replay([{ type: "session.ready", sessionId: "s1" }]).sessionId).toBe("s1");
  });

  test("turn.completed goes idle, records cost and usage and settles leftovers", () => {
    const running = replay([
      { type: "assistant.delta", text: "partial" },
      { type: "tool.started", toolUseId: "t1", name: "Bash", input: {} },
      { type: "permission.request", requestId: "r1", toolName: "Bash", input: {} },
    ], addUserMessage(fresh(), "go"));

    const done = applyBridgeEvent(running, { type: "turn.completed", costUsd: 0.5, usage });

    expect(done.status).toBe("idle");
    expect(done.costUsd).toBe(0.5);
    expect(done.usage).toEqual(usage);
    expect(done.items.find((item) => item.kind === "tool")).toMatchObject({ status: "error", summary: "Stopped before finishing" });
    expect(done.items.find((item) => item.kind === "permission")).toMatchObject({ status: "expired" });
    expect(done.items.find((item) => item.kind === "assistant")).toMatchObject({ streaming: false });
  });

  test("marks a tool that never reported a result as failed when the turn ends", () => {
    const thread = replay([
      { type: "tool.started", toolUseId: "t1", name: "Bash", input: {} },
      { type: "turn.completed", costUsd: 0, usage },
    ]);
    expect(thread.items[0]).toMatchObject({ status: "error" });
  });

  test("a non fatal error adds a notice and keeps running", () => {
    const thread = replay([{ type: "error", message: "rate limited" }], addUserMessage(fresh(), "go"));
    expect(thread.status).toBe("running");
    expect(thread.items.at(-1)).toMatchObject({ kind: "notice", text: "rate limited" });
  });

  test("a fatal error adds a notice and stops the thread", () => {
    const thread = replay([{ type: "error", message: "bridge exited", fatal: true }], addUserMessage(fresh(), "go"));
    expect(thread.status).toBe("idle");
    expect(thread.items.at(-1)).toMatchObject({ kind: "notice", text: "bridge exited" });
  });

  test("addNotice and stopRunning are available for app side failures", () => {
    const thread = stopRunning(addNotice(addUserMessage(fresh(), "go"), "could not reach the bridge"));
    expect(thread.status).toBe("idle");
    expect(thread.items.at(-1)).toMatchObject({ kind: "notice" });
  });

  test("never mutates the previous thread", () => {
    const before = fresh();
    const snapshot = structuredClone(before);
    applyBridgeEvent(before, { type: "assistant.delta", text: "x" });
    expect(before).toEqual(snapshot);
  });
});
