import { describe, expect, test } from "bun:test";
import type { BridgeEvent } from "@flare/protocol";

import { createCheckpointRouter } from "./checkpoint-router";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

function setup() {
  const calls: string[] = [];
  const route = createCheckpointRouter({
    turnStarted: () => {
      calls.push("started");
    },
    turnEnded: () => {
      calls.push("ended");
    },
  });
  return { route, calls };
}

describe("checkpoint router", () => {
  test("ignores commit message and pull request replies", () => {
    const { route, calls } = setup();
    route({ type: "commit.generated", requestId: "c1", subject: "fix: x", body: null });
    route({ type: "commit.failed", requestId: "c2", message: "nope" });
    route({ type: "pr.generated", requestId: "p1", title: "fix: x", body: "## Summary\n- x" });
    route({ type: "pr.failed", requestId: "p2", message: "nope" });
    expect(calls).toEqual([]);
  });

  test("snapshots when a turn starts and when it completes", () => {
    const { route, calls } = setup();
    route({ type: "turn.started" });
    route({ type: "turn.completed", costUsd: 0.01, usage: USAGE });
    expect(calls).toEqual(["started", "ended"]);
  });

  test("closes the turn when the session dies mid-turn", () => {
    const { route, calls } = setup();
    route({ type: "turn.started" });
    route({ type: "error", message: "Claude Code stopped", fatal: true });
    expect(calls).toEqual(["started", "ended"]);
  });

  test("ignores a recoverable error: the turn is still going", () => {
    const { route, calls } = setup();
    route({ type: "turn.started" });
    route({ type: "error", message: "rate limited" });
    route({ type: "error", message: "again", fatal: false });
    expect(calls).toEqual(["started"]);
  });

  test("ignores everything else the bridge says", () => {
    const { route, calls } = setup();
    const noise: BridgeEvent[] = [
      { type: "session.ready", sessionId: "s1" },
      { type: "assistant.delta", text: "hi" },
      { type: "tool.started", toolUseId: "t1", name: "Edit", input: {} },
      { type: "file.change", toolUseId: "t1", path: "a.ts", kind: "update", before: "a", after: "b" },
      { type: "tool.finished", toolUseId: "t1", isError: false, summary: "" },
    ];
    for (const event of noise) route(event);
    expect(calls).toEqual([]);
  });
});
