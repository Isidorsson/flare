import { describe, expect, test } from "bun:test";

import type { AgentSnapshot } from "./agent-controller";
import { selectComposerMode, selectIsBusy } from "./agent-selectors";
import { DEFAULT_SESSION_SETTINGS } from "./session-settings";
import { createThread, type Thread } from "./thread-types";

function thread(id: string, status: Thread["status"]): Thread {
  return { ...createThread({ id, cwd: "C:/work", createdAt: 0 }), status };
}

function snapshot(partial: Partial<AgentSnapshot>): AgentSnapshot {
  return { settings: DEFAULT_SESSION_SETTINGS, threads: [], activeThreadId: null, liveThreadId: null, ...partial };
}

describe("selectComposerMode", () => {
  test("asks for a folder when there is neither a folder nor a thread", () => {
    expect(selectComposerMode(snapshot({}), null)).toBe("no-folder");
  });

  test("allows continuing an existing thread even if the folder was cleared", () => {
    const state = snapshot({ threads: [thread("a", "idle")], activeThreadId: "a" });
    expect(selectComposerMode(state, null)).toBe("ready");
  });

  test("is ready when nothing is running", () => {
    expect(selectComposerMode(snapshot({}), "C:/work")).toBe("ready");
  });

  test("offers to stop the running thread that is being viewed", () => {
    const state = snapshot({ threads: [thread("a", "running")], activeThreadId: "a", liveThreadId: "a" });
    expect(selectComposerMode(state, "C:/work")).toBe("running");
  });

  test("blocks other threads, including a new draft, while one is running", () => {
    const threads = [thread("a", "running"), thread("b", "idle")];
    expect(selectComposerMode(snapshot({ threads, activeThreadId: "b", liveThreadId: "a" }), "C:/work")).toBe("blocked");
    expect(selectComposerMode(snapshot({ threads, activeThreadId: null, liveThreadId: "a" }), "C:/work")).toBe("blocked");
  });
});

describe("selectIsBusy", () => {
  test("only the live thread counts", () => {
    const threads = [thread("a", "running"), thread("b", "idle")];
    expect(selectIsBusy(snapshot({ threads, liveThreadId: "b" }))).toBe(false);
    expect(selectIsBusy(snapshot({ threads, liveThreadId: "a" }))).toBe(true);
    expect(selectIsBusy(snapshot({ threads, liveThreadId: null }))).toBe(false);
  });
});
