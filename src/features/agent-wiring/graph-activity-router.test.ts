import { describe, expect, test } from "bun:test";

import type { ActivityInput, AgentStatus } from "@/features/graph";

import { countChangedLines, createGraphActivityRouter } from "./graph-activity-router";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

function setup() {
  const activity: ActivityInput[] = [];
  const statuses: AgentStatus[] = [];
  let turns = 0;
  const route = createGraphActivityRouter({
    recordActivity: (input) => {
      activity.push(input);
    },
    setStatus: (status) => {
      statuses.push(status);
    },
    startTurn: () => {
      turns += 1;
    },
  });
  return { route, activity, statuses, turns: () => turns };
}

describe("graph activity router", () => {
  test("ignores commit message and pull request replies", () => {
    const { route, activity, statuses, turns } = setup();
    route({ type: "commit.generated", requestId: "c1", subject: "fix: x", body: null });
    route({ type: "commit.failed", requestId: "c2", message: "nope" });
    route({ type: "pr.generated", requestId: "p1", title: "fix: x", body: "## Summary\n- x" });
    route({ type: "pr.failed", requestId: "p2", message: "nope" });
    expect([activity, statuses, turns()]).toEqual([[], [], 0]);
  });

  test("starts a turn as working and finishes as done", () => {
    const { route, statuses, turns } = setup();
    route({ type: "turn.started" });
    route({ type: "turn.completed", costUsd: 0, usage: USAGE });
    expect(turns()).toBe(1);
    expect(statuses).toEqual(["working", "done"]);
  });

  test("reports thinking once per stretch of streamed text", () => {
    const { route, statuses } = setup();
    route({ type: "turn.started" });
    route({ type: "assistant.delta", text: "a" });
    route({ type: "assistant.delta", text: "b" });
    route({ type: "tool.started", toolUseId: "t", name: "Read", input: {} });
    expect(statuses).toEqual(["working", "thinking", "working"]);
  });

  test("labels search and shell tools without a file", () => {
    const { route, activity } = setup();
    route({ type: "tool.started", toolUseId: "t1", name: "Grep", input: { pattern: "useEffect" } });
    route({ type: "tool.started", toolUseId: "t2", name: "Bash", input: { command: "bun test\nmore" } });
    route({ type: "tool.started", toolUseId: "t3", name: "Read", input: { file_path: "a.ts" } });
    expect(activity).toEqual([
      { kind: "search", detail: "useEffect" },
      { kind: "run", detail: "bun test" },
    ]);
  });

  test("fires a read for each file read", () => {
    const { route, activity } = setup();
    route({ type: "file.read", toolUseId: "t", path: "C:\\app\\a.ts" });
    expect(activity).toEqual([{ path: "C:\\app\\a.ts", kind: "read" }]);
  });

  test("moves to a file once while its edit streams, then records the landed change", () => {
    const { route, activity } = setup();
    const editing = { type: "file.editing", toolUseId: "e", path: "a.ts", kind: "edit", text: "x" } as const;
    route(editing);
    route({ ...editing, text: "xy" });
    route({ type: "file.change", toolUseId: "e", path: "a.ts", kind: "update", before: "a\nb", after: "a\nc" });
    expect(activity).toEqual([
      { path: "a.ts", kind: "edit" },
      { path: "a.ts", kind: "edit", linesChanged: 2 },
    ]);
  });

  test("records a new file as a create", () => {
    const { route, activity } = setup();
    route({ type: "file.change", toolUseId: "w", path: "n.ts", kind: "create", before: null, after: "1\n2\n3" });
    expect(activity).toEqual([{ path: "n.ts", kind: "create", linesChanged: 3 }]);
  });

  test("goes idle only on a fatal error", () => {
    const { route, statuses } = setup();
    route({ type: "turn.started" });
    route({ type: "error", message: "hiccup" });
    route({ type: "error", message: "gone", fatal: true });
    expect(statuses).toEqual(["working", "idle"]);
  });
});

describe("countChangedLines", () => {
  test("counts lines that exist on only one side", () => {
    expect(countChangedLines("a\nb\nc", "a\nx\nc\ny")).toBe(3);
  });

  test("counts every line of a new file", () => {
    expect(countChangedLines(null, "a\nb")).toBe(2);
  });
});
