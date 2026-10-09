import { describe, expect, test } from "bun:test";

import { MAX_COMMIT_RECENT_SUBJECTS, type AppMessage, type BridgeEvent } from "@flare/protocol";

import { createAgentEventBus, type AgentEventBus } from "./agent-events";
import {
  createCommitMessageClient,
  type CommitMessageClientDeps,
  type CommitMessageInput,
} from "./commit-message-client";
import { rejectionOf } from "./testing/rejection-of";

const input: CommitMessageInput = {
  stat: " src/a.ts | 2 +-",
  patch: "diff --git a/src/a.ts b/src/a.ts\n-a\n+b\n",
  truncated: false,
  recentSubjects: ["feat(chat): stream replies"],
  includeBody: true,
};

function setup(overrides: Partial<CommitMessageClientDeps> = {}) {
  const bus: AgentEventBus = createAgentEventBus();
  const sent: AppMessage[] = [];
  let listeners = 0;
  let ids = 0;
  const generate = createCommitMessageClient({
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    subscribe: (listener) => {
      listeners += 1;
      const unsubscribe = bus.subscribe(listener);
      return () => {
        listeners -= 1;
        unsubscribe();
      };
    },
    createId: () => `req-${String((ids += 1))}`,
    timeoutMs: 5_000,
    ...overrides,
  });
  return { generate, bus, sent, listeners: () => listeners };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function generated(requestId: string, subject: string, body: string | null = null): BridgeEvent {
  return { type: "commit.generated", requestId, subject, body };
}

describe("generateCommitMessage", () => {
  test("sends commit.generate with the input and a fresh request id, then resolves with the reply", async () => {
    const { generate, bus, sent } = setup();

    const pending = generate(input);
    await tick();
    expect(sent).toEqual([{ type: "commit.generate", requestId: "req-1", ...input }]);

    bus.publish(generated("req-1", "fix(a): bump a", "Because b."));
    expect(await pending).toEqual({ subject: "fix(a): bump a", body: "Because b." });
  });

  test("resolves a reply without a body", async () => {
    const { generate, bus } = setup();

    const pending = generate({ ...input, includeBody: false });
    await tick();
    bus.publish(generated("req-1", "fix: x"));

    expect(await pending).toEqual({ subject: "fix: x", body: null });
  });

  test("rejects with the bridge's reason when generation fails", async () => {
    const { generate, bus } = setup();

    const pending = generate(input);
    await tick();
    bus.publish({ type: "commit.failed", requestId: "req-1", message: "Claude took longer than 45s" });

    expect((await rejectionOf(pending)).message).toBe("Claude took longer than 45s");
  });

  test("ignores replies for other requests and unrelated events", async () => {
    const { generate, bus } = setup();

    const pending = generate(input);
    await tick();
    bus.publish(generated("someone-else", "feat: not mine"));
    bus.publish({ type: "commit.failed", requestId: "someone-else", message: "not mine either" });
    bus.publish({ type: "assistant.delta", text: "hello" });
    bus.publish({ type: "error", message: "unrelated", fatal: false });
    bus.publish(generated("req-1", "fix: mine"));

    expect(await pending).toEqual({ subject: "fix: mine", body: null });
  });

  test("matches concurrent requests by their ids", async () => {
    const { generate, bus } = setup();

    const first = generate(input);
    const second = generate({ ...input, includeBody: false });
    const third = generate(input);
    await tick();
    bus.publish(generated("req-2", "fix: second"));
    bus.publish({ type: "commit.failed", requestId: "req-3", message: "third failed" });
    bus.publish(generated("req-1", "fix: first"));

    expect(await first).toEqual({ subject: "fix: first", body: null });
    expect(await second).toEqual({ subject: "fix: second", body: null });
    expect((await rejectionOf(third)).message).toBe("third failed");
  });

  test("accepts a reply that arrives before the send has finished", async () => {
    const bus = createAgentEventBus();
    const { generate } = setup({
      subscribe: (listener) => bus.subscribe(listener),
      send: async () => {
        bus.publish(generated("req-1", "fix: early"));
        await tick();
      },
    });

    expect(await generate(input)).toEqual({ subject: "fix: early", body: null });
  });

  test("rejects when no reply arrives in time and stops listening", async () => {
    const { generate, listeners } = setup({ timeoutMs: 20 });

    expect((await rejectionOf(generate(input))).message).toBe("Timed out after 0.02s waiting for the commit message");
    expect(listeners()).toBe(0);
  });

  test("ignores a reply that arrives after the timeout", async () => {
    const { generate, bus } = setup({ timeoutMs: 10 });

    expect((await rejectionOf(generate(input))).message).toContain("Timed out");
    bus.publish(generated("req-1", "fix: too late"));
  });

  test("stops listening once it has a reply", async () => {
    const { generate, bus, listeners } = setup();

    const pending = generate(input);
    await tick();
    expect(listeners()).toBe(1);
    bus.publish(generated("req-1", "fix: x"));
    await pending;

    expect(listeners()).toBe(0);
  });

  test("rejects with the send failure and stops listening", async () => {
    const { generate, listeners } = setup({
      send: () => Promise.reject(new Error("The agent bridge could not start")),
    });

    expect((await rejectionOf(generate(input))).message).toBe("The agent bridge could not start");
    expect(listeners()).toBe(0);
  });

  test("sends only the most recent subjects the protocol allows", async () => {
    const { generate, bus, sent } = setup();
    const recentSubjects = Array.from({ length: MAX_COMMIT_RECENT_SUBJECTS + 5 }, (_, index) => `fix: ${String(index)}`);

    const pending = generate({ ...input, recentSubjects });
    await tick();
    bus.publish(generated("req-1", "fix: x"));
    await pending;

    const request = sent[0];
    expect(request?.type === "commit.generate" ? request.recentSubjects : []).toEqual(
      recentSubjects.slice(0, MAX_COMMIT_RECENT_SUBJECTS),
    );
  });

  test("passes the truncated flag and an empty diff through", async () => {
    const { generate, bus, sent } = setup();

    const pending = generate({ ...input, patch: "", truncated: true, recentSubjects: [] });
    await tick();
    bus.publish(generated("req-1", "chore: x"));
    await pending;

    expect(sent[0]).toMatchObject({ patch: "", truncated: true, recentSubjects: [] });
  });
});
