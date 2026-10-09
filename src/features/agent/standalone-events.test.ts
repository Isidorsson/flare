import { describe, expect, test } from "bun:test";
import type { BridgeEvent } from "@flare/protocol";

import { isStandaloneEvent } from "./standalone-events";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

describe("isStandaloneEvent", () => {
  test.each<BridgeEvent>([
    { type: "commit.generated", requestId: "c1", subject: "fix: x", body: null },
    { type: "commit.failed", requestId: "c1", message: "nope" },
    { type: "pr.generated", requestId: "p1", title: "fix: x", body: "" },
    { type: "pr.failed", requestId: "p1", message: "nope" },
  ])("treats %o as the answer to a standalone request", (event) => {
    expect(isStandaloneEvent(event)).toBe(true);
  });

  test.each<BridgeEvent>([
    { type: "turn.started" },
    { type: "turn.completed", costUsd: 0, usage },
    { type: "assistant.delta", text: "hi" },
    { type: "error", message: "boom" },
  ])("leaves %o to the conversation", (event) => {
    expect(isStandaloneEvent(event)).toBe(false);
  });
});
