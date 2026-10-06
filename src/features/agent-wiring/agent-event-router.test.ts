import { describe, expect, test } from "bun:test";
import type { BridgeEvent } from "@flare/protocol";

import type { AgentFileChange } from "@/features/files/files-types";

import { createAgentEventRouter } from "./agent-event-router";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

function fileChange(path: string): BridgeEvent {
  return { type: "file.change", toolUseId: `tool-${path}`, path, kind: "update", before: "a", after: "b" };
}

function setup() {
  const changes: AgentFileChange[] = [];
  const reads: string[] = [];
  const pulses: string[] = [];
  const route = createAgentEventRouter({
    applyFileChange: (change) => {
      changes.push(change);
    },
    noteFileRead: (path) => {
      reads.push(path);
    },
    pulse: (path, kind) => {
      pulses.push(`${kind}:${path}`);
    },
  });
  return { route, changes, reads, pulses };
}

describe("agent event router", () => {
  test("forwards a file change without its type tag, attributed to the current turn", () => {
    const { route, changes } = setup();
    route(fileChange("C:\\app\\a.ts"));
    expect(changes).toEqual([
      {
        turnId: "turn-1",
        toolUseId: "tool-C:\\app\\a.ts",
        path: "C:\\app\\a.ts",
        kind: "update",
        before: "a",
        after: "b",
      },
    ]);
  });

  test("starts a new turn after turn.completed", () => {
    const { route, changes } = setup();
    route(fileChange("a"));
    route({ type: "turn.completed", costUsd: 0.01, usage: USAGE });
    route(fileChange("b"));
    expect(changes.map((change) => change.turnId)).toEqual(["turn-1", "turn-2"]);
  });

  test("forwards file reads", () => {
    const { route, reads } = setup();
    route({ type: "file.read", toolUseId: "t", path: "C:\\app\\b.ts" });
    expect(reads).toEqual(["C:\\app\\b.ts"]);
  });

  test("pulses the graph for reads and changes", () => {
    const { route, pulses } = setup();
    route({ type: "file.read", toolUseId: "t", path: "a.ts" });
    route(fileChange("b.ts"));
    expect(pulses).toEqual(["read:a.ts", "change:b.ts"]);
  });

  test("ignores unrelated events", () => {
    const { route, changes, reads, pulses } = setup();
    route({ type: "assistant.delta", text: "hi" });
    expect(changes).toEqual([]);
    expect(reads).toEqual([]);
    expect(pulses).toEqual([]);
  });
});
