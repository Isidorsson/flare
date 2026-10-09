import { describe, expect, test } from "bun:test";

import type { BridgeEvent } from "@flare/protocol";

import { createAgentEventBus } from "./agent-events";
import type { OneShotClientDeps } from "./one-shot-client";
import { createPullRequestClient, type PullRequestInput } from "./pr-message-client";
import { createOneShotTestBed, tick } from "./testing/one-shot-test-bed";
import { rejectionOf } from "./testing/rejection-of";

const input: PullRequestInput = {
  branch: "feat/login",
  base: "main",
  commits: [
    { subject: "feat(auth): add the login form", body: "" },
    { subject: "fix(auth): trim the email", body: "Pasted addresses kept a trailing space." },
  ],
  stat: " src/login.ts | 10 ++++\n 1 file changed, 10 insertions(+)",
  truncated: false,
};

function setup(overrides: Partial<OneShotClientDeps> = {}) {
  const bed = createOneShotTestBed(overrides);
  return { generate: createPullRequestClient(bed.deps), bus: bed.bus, sent: bed.sent, listeners: bed.listeners };
}

function generated(requestId: string, title: string, body = "## Summary\n- x"): BridgeEvent {
  return { type: "pr.generated", requestId, title, body };
}

describe("generatePullRequest", () => {
  test("sends pr.generate with the input and a fresh request id, then resolves with the reply", async () => {
    const { generate, bus, sent } = setup();

    const pending = generate(input);
    await tick();
    expect(sent).toEqual([{ type: "pr.generate", requestId: "req-1", ...input }]);

    bus.publish(generated("req-1", "feat(auth): add login", "## Summary\n- Add a form."));
    expect(await pending).toEqual({ title: "feat(auth): add login", body: "## Summary\n- Add a form." });
  });

  test("resolves a reply with an empty body", async () => {
    const { generate, bus } = setup();

    const pending = generate(input);
    await tick();
    bus.publish(generated("req-1", "fix: x", ""));

    expect(await pending).toEqual({ title: "fix: x", body: "" });
  });

  test("rejects with the bridge's reason when generation fails", async () => {
    const { generate, bus } = setup();

    const pending = generate(input);
    await tick();
    bus.publish({ type: "pr.failed", requestId: "req-1", message: "There are no commits to describe." });

    expect((await rejectionOf(pending)).message).toBe("There are no commits to describe.");
  });

  test("ignores replies for other requests, commit replies and unrelated events", async () => {
    const { generate, bus } = setup();

    const pending = generate(input);
    await tick();
    bus.publish(generated("someone-else", "feat: not mine"));
    bus.publish({ type: "pr.failed", requestId: "someone-else", message: "not mine either" });
    bus.publish({ type: "commit.generated", requestId: "req-1", subject: "fix: a commit", body: null });
    bus.publish({ type: "commit.failed", requestId: "req-1", message: "a commit failed" });
    bus.publish({ type: "assistant.delta", text: "hello" });
    bus.publish(generated("req-1", "fix: mine"));

    expect(await pending).toEqual({ title: "fix: mine", body: "## Summary\n- x" });
  });

  test("matches concurrent requests by their ids", async () => {
    const { generate, bus } = setup();

    const first = generate(input);
    const second = generate(input);
    await tick();
    bus.publish({ type: "pr.failed", requestId: "req-2", message: "second failed" });
    bus.publish(generated("req-1", "fix: first"));

    expect((await first).title).toBe("fix: first");
    expect((await rejectionOf(second)).message).toBe("second failed");
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

    expect((await generate(input)).title).toBe("fix: early");
  });

  test("rejects when no reply arrives in time and stops listening", async () => {
    const { generate, listeners } = setup({ timeoutMs: 20 });

    expect((await rejectionOf(generate(input))).message).toBe(
      "Timed out after 0.02s waiting for the pull request description",
    );
    expect(listeners()).toBe(0);
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

  test("passes a cut commit list and an empty stat through", async () => {
    const { generate, bus, sent } = setup();

    const pending = generate({ ...input, commits: [], stat: "", truncated: true });
    await tick();
    bus.publish(generated("req-1", "fix: x"));
    await pending;

    expect(sent[0]).toMatchObject({ commits: [], stat: "", truncated: true });
  });

  test("rejects input the protocol would refuse without sending anything", async () => {
    const { generate, sent, listeners } = setup();

    await rejectionOf(generate({ ...input, base: "" }));

    expect(sent).toEqual([]);
    expect(listeners()).toBe(0);
  });
});
