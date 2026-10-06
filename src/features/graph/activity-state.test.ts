import { describe, expect, test } from "bun:test";

import {
  agentLabel,
  agentTone,
  applyStatus,
  beginTurn,
  COMET_IDLE_MS,
  describeTouch,
  initialActivity,
  isChangedThisTurn,
  pushRecent,
  recordTouch,
  RECENT_LIMIT,
  type ActivityState,
  type ResolveNode,
} from "./activity-state";
import type { ActivityInput } from "./activity-types";

const resolve: ResolveNode = (path) => (path.startsWith("src/") ? path : null);

function record(state: ActivityState, input: ActivityInput, now: number): ActivityState {
  return recordTouch(state, describeTouch(input, resolve), now);
}

describe("describeTouch", () => {
  test("names a file touch by its base name, whatever the separator", () => {
    expect(describeTouch({ path: "C:\\app\\src\\a.ts", kind: "read" }, () => "src/a.ts").subject).toBe("a.ts");
  });

  test("names searches and commands by their detail", () => {
    expect(describeTouch({ kind: "search", detail: "useEffect" }, resolve).subject).toBe("useEffect");
    expect(describeTouch({ kind: "run", detail: "bun test", path: "src/x.ts" }, resolve).subject).toBe("bun test");
  });

  test("falls back to the file when a search has no detail, and to the detail when a read has no path", () => {
    expect(describeTouch({ kind: "search", path: "src/a.ts" }, resolve).subject).toBe("a.ts");
    expect(describeTouch({ kind: "read", detail: "notes" }, resolve).subject).toBe("notes");
  });

  test("resolves the node, treating unresolvable paths as outside the graph", () => {
    expect(describeTouch({ kind: "read", path: "src/a.ts" }, resolve).nodeId).toBe("src/a.ts");
    expect(describeTouch({ kind: "read", path: "/etc/hosts" }, resolve).nodeId).toBeNull();
    expect(describeTouch({ kind: "run", detail: "ls" }, resolve).nodeId).toBeNull();
  });

  test("defaults to the agent as the source and clamps negative line counts", () => {
    const described = describeTouch({ kind: "edit", path: "src/a.ts", linesChanged: -4 }, resolve);
    expect(described.source).toBe("agent");
    expect(described.linesChanged).toBe(0);
  });
});

describe("recordTouch", () => {
  test("counts reads and edits and sums the lines changed per node", () => {
    let state = initialActivity();
    state = record(state, { path: "src/a.ts", kind: "read" }, 100);
    state = record(state, { path: "src/a.ts", kind: "edit", linesChanged: 10 }, 200);
    state = record(state, { path: "src/a.ts", kind: "create", linesChanged: 5 }, 300);
    expect(state.nodes.get("src/a.ts")).toEqual({
      reads: 1,
      edits: 2,
      linesChanged: 15,
      lastKind: "create",
      lastTouchedAt: 300,
      changedTurn: 1,
    });
  });

  test("moves to working and sets the current action", () => {
    const state = record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 50);
    expect(state.status).toBe("working");
    expect(state.current).toEqual({ kind: "edit", subject: "a.ts" });
    expect(state.lastNodeId).toBe("src/a.ts");
    expect(state.lastMoveAt).toBe(50);
  });

  test("emits a touch event naming where the agent came from", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "read" }, 10);
    state = record(state, { path: "src/b.ts", kind: "edit" }, 20);
    expect(state.lastEvent).toEqual({
      type: "touch",
      seq: 2,
      at: 20,
      kind: "edit",
      nodeId: "src/b.ts",
      from: "src/a.ts",
      movesComet: true,
    });
  });

  test("a path outside the graph updates the label but keeps the comet where it was", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "read" }, 10);
    state = record(state, { path: "/etc/hosts", kind: "read" }, 20);
    expect(state.nodes.size).toBe(1);
    expect(state.lastNodeId).toBe("src/a.ts");
    expect(state.recent).toEqual(["src/a.ts"]);
    expect(state.current).toEqual({ kind: "read", subject: "hosts" });
    expect(state.lastEvent).toMatchObject({ nodeId: null, movesComet: true });
  });

  test("does not mutate the previous state", () => {
    const before = initialActivity();
    record(before, { path: "src/a.ts", kind: "edit" }, 5);
    expect(before.nodes.size).toBe(0);
    expect(before.seq).toBe(0);
  });
});

describe("disk changes", () => {
  const working = record(initialActivity(), { path: "src/a.ts", kind: "read" }, 1000);

  test("do not move the comet while the agent is active", () => {
    const state = record(working, { path: "src/b.ts", kind: "edit", source: "disk" }, 1000 + COMET_IDLE_MS);
    expect(state.lastEvent).toMatchObject({ nodeId: "src/b.ts", movesComet: false });
    expect(state.lastNodeId).toBe("src/a.ts");
    expect(state.recent).toEqual(["src/a.ts"]);
    expect(state.current).toEqual(working.current);
    expect(state.status).toBe("working");
  });

  test("still heat the file, without counting as an agent edit", () => {
    const state = record(working, { path: "src/b.ts", kind: "edit", source: "disk", linesChanged: 40 }, 1200);
    expect(state.nodes.get("src/b.ts")).toEqual({
      reads: 0,
      edits: 0,
      linesChanged: 0,
      lastKind: "edit",
      lastTouchedAt: 1200,
      changedTurn: null,
    });
  });

  test("move the comet once it has been idle for more than 1.5 s", () => {
    const state = record(working, { path: "src/b.ts", kind: "edit", source: "disk" }, 1000 + COMET_IDLE_MS + 1);
    expect(state.lastEvent).toMatchObject({ nodeId: "src/b.ts", movesComet: true });
    expect(state.lastNodeId).toBe("src/b.ts");
    expect(state.recent).toEqual(["src/a.ts", "src/b.ts"]);
    expect(state.status).toBe("working");
  });

  test("never summon the comet while the agent is idle", () => {
    const state = record(initialActivity(), { path: "src/b.ts", kind: "edit", source: "disk" }, 99_999);
    expect(state.lastEvent).toMatchObject({ movesComet: false });
    expect(state.status).toBe("idle");
    expect(state.lastNodeId).toBeNull();
  });
});

describe("recent path", () => {
  test("lists distinct files, newest last", () => {
    expect(pushRecent(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });

  test("keeps only the last 12", () => {
    let recent: readonly string[] = [];
    for (let index = 0; index < RECENT_LIMIT + 5; index += 1) recent = pushRecent(recent, `f${String(index)}`);
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]).toBe("f5");
    expect(recent.at(-1)).toBe("f16");
  });

  test("only files the comet actually moved to join the path", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "read" }, 1);
    state = record(state, { kind: "search", detail: "x" }, 2);
    state = record(state, { path: "src/b.ts", kind: "read" }, 3);
    expect(state.recent).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("status", () => {
  test("done emits one finish event at the last node", () => {
    const working = record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 10);
    const done = applyStatus(working, "done", 20);
    expect(done.status).toBe("done");
    expect(done.lastEvent).toEqual({ type: "finish", seq: 2, at: 20, nodeId: "src/a.ts" });
    expect(applyStatus(done, "done", 30)).toBe(done);
  });

  test("thinking and idle emit no event", () => {
    const working = record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 10);
    const thinking = applyStatus(working, "thinking", 20);
    expect(thinking.status).toBe("thinking");
    expect(thinking.lastEvent).toBe(working.lastEvent);
    expect(applyStatus(thinking, "idle", 30).lastEvent).toBe(working.lastEvent);
  });

  test("leaving work forgets the last action, so resuming shows a plain Working", () => {
    const working = record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 10);
    const thinking = applyStatus(working, "thinking", 20);
    expect(thinking.current).toBeNull();
    const resumed = applyStatus(thinking, "working", 30);
    expect(agentLabel(resumed.status, resumed.current)).toBe("Working");
  });

  test("new activity after done goes back to working", () => {
    const done = applyStatus(record(initialActivity(), { path: "src/a.ts", kind: "read" }, 1), "done", 2);
    expect(record(done, { path: "src/b.ts", kind: "read" }, 3).status).toBe("working");
  });
});

describe("turns", () => {
  test("startTurn clears the changed-this-turn marks without touching heat", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 10);
    state = record(state, { path: "src/b.ts", kind: "read" }, 11);
    const node = state.nodes.get("src/a.ts");
    expect(node !== undefined && isChangedThisTurn(node, state.turn)).toBe(true);
    const next = beginTurn(state);
    const after = next.nodes.get("src/a.ts");
    expect(after !== undefined && isChangedThisTurn(after, next.turn)).toBe(false);
    expect(after?.edits).toBe(1);
    expect(next.nodes).toBe(state.nodes);
  });

  test("an edit in the new turn is marked again", () => {
    const next = record(beginTurn(record(initialActivity(), { path: "src/a.ts", kind: "edit" }, 1)), { path: "src/a.ts", kind: "edit" }, 2);
    const node = next.nodes.get("src/a.ts");
    expect(node !== undefined && isChangedThisTurn(node, next.turn)).toBe(true);
  });

  test("reads never mark a file as changed", () => {
    const state = record(initialActivity(), { path: "src/a.ts", kind: "read" }, 1);
    const node = state.nodes.get("src/a.ts");
    expect(node !== undefined && isChangedThisTurn(node, state.turn)).toBe(false);
  });
});

describe("turn line tally", () => {
  test("adds up the lines the agent changed this turn and resets with the turn", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "edit", linesChanged: 12 }, 1);
    state = record(state, { path: "src/b.ts", kind: "create", linesChanged: 30 }, 2);
    expect(state.turnLines).toBe(42);
    expect(beginTurn(state).turnLines).toBe(0);
  });

  test("ignores reads and changes made on disk", () => {
    let state = record(initialActivity(), { path: "src/a.ts", kind: "read", linesChanged: 99 }, 1);
    state = record(state, { path: "src/a.ts", kind: "edit", linesChanged: 5, source: "disk" }, 2);
    expect(state.turnLines).toBe(0);
  });
});

describe("agentTone", () => {
  test("reading, searching and thinking explore; everything else is the agent at work", () => {
    expect(agentTone("working", { kind: "read", subject: null })).toBe("explore");
    expect(agentTone("working", { kind: "search", subject: null })).toBe("explore");
    expect(agentTone("thinking", null)).toBe("explore");
    expect(agentTone("working", { kind: "edit", subject: null })).toBe("agent");
    expect(agentTone("working", { kind: "run", subject: null })).toBe("agent");
    expect(agentTone("done", { kind: "read", subject: null })).toBe("agent");
  });
});

describe("agentLabel", () => {
  test("describes each kind of action", () => {
    expect(agentLabel("working", { kind: "read", subject: "file.ts" })).toBe("Reading · file.ts");
    expect(agentLabel("working", { kind: "edit", subject: "file.ts" })).toBe("Editing · file.ts");
    expect(agentLabel("working", { kind: "create", subject: "new.ts" })).toBe("Creating · new.ts");
    expect(agentLabel("working", { kind: "search", subject: "useEffect" })).toBe("Searching · useEffect");
    expect(agentLabel("working", { kind: "run", subject: "bun test" })).toBe("Running · bun test");
  });

  test("status wins for thinking and done, and idle shows nothing", () => {
    const action = { kind: "read", subject: "file.ts" } as const;
    expect(agentLabel("thinking", action)).toBe("Thinking");
    expect(agentLabel("done", action)).toBe("Done");
    expect(agentLabel("idle", action)).toBeNull();
  });

  test("copes with working before any action, and with a missing subject", () => {
    expect(agentLabel("working", null)).toBe("Working");
    expect(agentLabel("working", { kind: "run", subject: null })).toBe("Running");
  });

  test("shortens very long subjects", () => {
    const label = agentLabel("working", { kind: "run", subject: "x".repeat(200) });
    expect(label?.endsWith("…")).toBe(true);
    expect(label?.length).toBeLessThan(60);
  });
});
