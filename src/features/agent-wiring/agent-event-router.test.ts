import { describe, expect, test } from "bun:test";
import type { BridgeEvent } from "@flare/protocol";

import type { AgentFileChange, AgentFileEditing, AgentFileRead } from "@/features/files";

import { createAgentEventRouter } from "./agent-event-router";

const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

function fileChange(path: string): BridgeEvent {
  return { type: "file.change", toolUseId: `tool-${path}`, path, kind: "update", before: "a", after: "b" };
}

function setup() {
  const changes: AgentFileChange[] = [];
  const reads: AgentFileRead[] = [];
  const editing: AgentFileEditing[] = [];
  const calls: string[] = [];
  const route = createAgentEventRouter({
    startTurn: (turnId) => {
      calls.push(`startTurn:${turnId}`);
    },
    endTurn: () => {
      calls.push("endTurn");
    },
    applyFileChange: (change) => {
      changes.push(change);
    },
    noteFileRead: (read) => {
      reads.push(read);
    },
    noteFileEditing: (event) => {
      editing.push(event);
    },
    endFileEditing: (toolUseId) => {
      calls.push(`endEditing:${toolUseId}`);
    },
  });
  return { route, changes, reads, editing, calls };
}

describe("file changes", () => {
  test("forwards a file change without its type tag, attributed to the current turn", () => {
    const { route, changes } = setup();
    route({ type: "turn.started" });
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

});

describe("commit messages", () => {
  test("are not agent activity and reach no sink", () => {
    const { route, changes, reads, editing, calls } = setup();
    route({ type: "commit.generated", requestId: "c1", subject: "fix: x", body: null });
    route({ type: "commit.failed", requestId: "c2", message: "nope" });
    expect([changes, reads, editing, calls]).toEqual([[], [], [], []]);
  });
});

describe("turns", () => {
  test("starts a new turn with each turn.started and tells the files panel", () => {
    const { route, changes, calls } = setup();
    route({ type: "turn.started" });
    route(fileChange("a"));
    route({ type: "turn.completed", costUsd: 0.01, usage: USAGE });
    route({ type: "turn.started" });
    route(fileChange("b"));
    expect(changes.map((change) => change.turnId)).toEqual(["turn-1", "turn-2"]);
    expect(calls).toEqual(["startTurn:turn-1", "endTurn", "startTurn:turn-2"]);
  });

  test("does not advance the turn on turn.completed alone", () => {
    const { route, changes } = setup();
    route({ type: "turn.started" });
    route({ type: "turn.completed", costUsd: 0, usage: USAGE });
    route(fileChange("a"));
    expect(changes[0]?.turnId).toBe("turn-1");
  });

  test("a fatal error ends the turn, an ordinary one does not", () => {
    const { route, calls } = setup();
    route({ type: "error", message: "oops" });
    expect(calls).toEqual([]);
    route({ type: "error", message: "gone", fatal: true });
    expect(calls).toEqual(["endTurn"]);
  });
});

describe("file reads", () => {
  test("forwards a plain read with no range or search", () => {
    const { route, reads } = setup();
    route({ type: "file.read", toolUseId: "t", path: "C:\\app\\b.ts" });
    expect(reads).toEqual([{ path: "C:\\app\\b.ts", range: null, pattern: null, matchLines: null }]);
  });

  test("passes the range of a Read through", () => {
    const { route, reads } = setup();
    route({ type: "file.read", toolUseId: "t", path: "a.ts", range: { start: 10, end: 40 } });
    expect(reads).toEqual([{ path: "a.ts", range: { start: 10, end: 40 }, pattern: null, matchLines: null }]);
  });

  test("passes the pattern and matching lines of a single-file search through", () => {
    const { route, reads } = setup();
    route({ type: "file.read", toolUseId: "t", path: "a.ts", pattern: "useEffect", matchLines: [3, 9] });
    expect(reads).toEqual([{ path: "a.ts", range: null, pattern: "useEffect", matchLines: [3, 9] }]);
  });

});

describe("file editing", () => {
  test("passes the edit that is being typed through, without its type tag", () => {
    const { route, editing } = setup();
    route({ type: "file.editing", toolUseId: "t1", path: "a.ts", kind: "edit", oldString: "old", text: "ne" });
    expect(editing).toEqual([{ toolUseId: "t1", path: "a.ts", kind: "edit", oldString: "old", text: "ne" }]);
  });

  test("gives a write no old string", () => {
    const { route, editing } = setup();
    route({ type: "file.editing", toolUseId: "t1", path: "n.ts", kind: "write", text: "x" });
    expect(editing).toEqual([{ toolUseId: "t1", path: "n.ts", kind: "write", oldString: null, text: "x" }]);
  });


  test("tells the files panel when a tool finishes so an edit that never landed is dropped", () => {
    const { route, calls } = setup();
    route({ type: "tool.finished", toolUseId: "t1", isError: true, summary: "denied" });
    expect(calls).toEqual(["endEditing:t1"]);
  });
});

test("ignores unrelated events", () => {
  const { route, changes, reads, editing, calls } = setup();
  route({ type: "assistant.delta", text: "hi" });
  route({ type: "session.ready", sessionId: "s" });
  expect([changes, reads, editing, calls]).toEqual([[], [], [], []]);
});
