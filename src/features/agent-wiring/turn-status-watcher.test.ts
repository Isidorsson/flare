import { describe, expect, test } from "bun:test";

import type { AgentSnapshot } from "@/features/agent/agent-controller";
import { DEFAULT_SESSION_SETTINGS } from "@/features/agent/session-settings";
import { createThread, type Thread } from "@/features/agent/thread-types";

import { createTurnStatusWatcher } from "./turn-status-watcher";

function thread(id: string, status: Thread["status"]): Thread {
  return { ...createThread({ id, cwd: "C:/work", createdAt: 1 }), status };
}

function snapshot(threads: Thread[]): AgentSnapshot {
  return { settings: DEFAULT_SESSION_SETTINGS, threads, activeThreadId: null, liveThreadId: null, outputStyles: [] };
}

function setup() {
  const calls: string[] = [];
  const watch = createTurnStatusWatcher({
    turnStarted: (started) => {
      calls.push(`started ${started.id}`);
    },
    turnEnded: () => {
      calls.push("ended");
    },
  });
  return { watch, calls };
}

describe("turn status watcher", () => {
  test("a message sent to an idle thread starts a turn", () => {
    const { watch, calls } = setup();
    watch(snapshot([thread("t1", "running")]), snapshot([thread("t1", "idle")]));
    expect(calls).toEqual(["started t1"]);
  });

  test("a message sent to a brand new thread starts a turn too", () => {
    const { watch, calls } = setup();
    watch(snapshot([thread("t1", "running")]), snapshot([]));
    expect(calls).toEqual(["started t1"]);
  });

  test("a thread going idle ends the turn", () => {
    const { watch, calls } = setup();
    watch(snapshot([thread("t1", "idle")]), snapshot([thread("t1", "running")]));
    expect(calls).toEqual(["ended"]);
  });

  test("updates while the thread keeps running change nothing", () => {
    const { watch, calls } = setup();
    watch(snapshot([thread("t1", "running")]), snapshot([thread("t1", "running")]));
    watch(snapshot([thread("t1", "idle")]), snapshot([thread("t1", "idle")]));
    expect(calls).toEqual([]);
  });

  test("an update that leaves the thread list untouched is skipped", () => {
    const { watch, calls } = setup();
    const threads = [thread("t1", "running")];
    watch({ ...snapshot(threads), activeThreadId: "t1" }, snapshot(threads));
    expect(calls).toEqual([]);
  });

  test("deleting a running thread ends its turn", () => {
    const { watch, calls } = setup();
    watch(snapshot([]), snapshot([thread("t1", "running")]));
    expect(calls).toEqual(["ended"]);
  });

  test("only the thread that changed is reported", () => {
    const { watch, calls } = setup();
    watch(
      snapshot([thread("t1", "idle"), thread("t2", "running")]),
      snapshot([thread("t1", "idle"), thread("t2", "idle")]),
    );
    expect(calls).toEqual(["started t2"]);
  });
});
