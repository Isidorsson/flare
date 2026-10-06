import { describe, expect, test } from "bun:test";

import { normalizePath } from "../paths";
import { ROOT, agentChange, openedStore } from "../test-support";
import { AgentActivity, type AgentFileEditing, type AgentFileRead } from "./agent-activity";
import { createFakeScheduler } from "./fake-scheduler";
import { createLiveStore } from "./live-store";
import type { Play } from "./live-types";

const A = `${ROOT}/src/a.ts`;
const B = `${ROOT}/src/b.ts`;
const NEW = `${ROOT}/src/new.ts`;
const OLD_A = "one\ntwo\nthree\n";
const NEW_A = "one\nTWO\nthree\nfour\n";

async function setup(files: Record<string, string> = { [A]: OLD_A, [B]: "beta\n" }) {
  const harness = await openedStore(files);
  const live = createLiveStore();
  const scheduler = createFakeScheduler();
  const activity = new AgentActivity({ files: harness.store, live, scheduler, now: () => harness.clock.now });
  async function flush() {
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
  }
  // Lets pending promises finish, then moves time forward a millisecond at a time so timers can start more work.
  async function settle(ms = 0) {
    await flush();
    for (let elapsed = 0; elapsed < ms; elapsed += 1) {
      scheduler.advance(1);
      await flush();
    }
  }
  // The agent's tool has already written the file by the time the change is reported.
  function change(overrides: Parameters<typeof agentChange>[0]) {
    const full = agentChange(overrides);
    harness.gateway.disk.set(normalizePath(full.path), full.after);
    activity.applyChange(full);
  }
  return { ...harness, live, scheduler, activity, flush, settle, change, play: () => live.getState().play };
}

function stepsOf(play: Play | null): number[] {
  return play?.kind === "edit" ? play.steps.map((step) => step.added) : [];
}

const read = (path: string, extra: Partial<AgentFileRead> = {}): AgentFileRead => ({
  path,
  range: null,
  pattern: null,
  matchLines: null,
  ...extra,
});

const editing = (path: string, text: string, extra: Partial<AgentFileEditing> = {}): AgentFileEditing => ({
  toolUseId: "tool-1",
  path,
  kind: "edit",
  oldString: "two",
  text,
  ...extra,
});

describe("reads", () => {
  test("open the file as a preview tab and light up the lines that were read", async () => {
    const { activity, state, play, settle } = await setup();
    activity.noteRead(read(A, { range: { start: 2, end: 3 } }));
    await settle();
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(state().files[A]?.preview).toBe(true);
    expect(play()).toMatchObject({ kind: "read", path: A, request: { range: { start: 2, end: 3 } }, instantScroll: true });
  });

  test("carry the pattern and matching lines of a search", async () => {
    const { activity, play, settle } = await setup();
    activity.noteRead(read(A, { pattern: "two", matchLines: [2] }));
    await settle();
    expect(play()).toMatchObject({ kind: "read", request: { pattern: "two", matchLines: [2] } });
  });

  test("heat the file even when follow is off, without showing anything", async () => {
    const { activity, state, live, play, settle } = await setup();
    state().setFollow(false);
    activity.noteRead(read(A));
    await settle();
    expect(state().active).toBeNull();
    expect(play()).toBeNull();
    expect(live.getState().touches[A]).toMatchObject({ reads: 1, edits: 0 });
  });

  test("are still drawn on the file the user has open when follow is off", async () => {
    const { activity, state, play, settle } = await setup();
    await state().openFile(A);
    state().setFollow(false);
    activity.noteRead(read(A));
    await settle();
    expect(play()).toMatchObject({ kind: "read", path: A, instantScroll: false });
  });

  test("ignore files outside the workspace", async () => {
    const { activity, live, play, settle } = await setup();
    activity.noteRead(read("C:/elsewhere/secret.txt"));
    await settle();
    expect(play()).toBeNull();
    expect(live.getState().touches).toEqual({});
  });

  test("do not take the editor while the user is typing", async () => {
    const { activity, state, play, clock, settle } = await setup();
    await state().openFile(B);
    clock.now += 20_000;
    state().setDraft(B, "beta typed");
    activity.noteRead(read(A));
    await settle();
    expect(state().active).toEqual({ kind: "file", path: B });
    expect(play()).toBeNull();
  });

  test("play one after another with a pause between", async () => {
    const { activity, state, play, settle } = await setup();
    activity.noteRead(read(A));
    activity.noteRead(read(B));
    await settle(379);
    expect(play()).toMatchObject({ path: A });
    await settle(2);
    expect(play()).toMatchObject({ path: B });
    expect(state().active).toEqual({ kind: "file", path: B });
  });

  test("fade out of the editor after seven seconds", async () => {
    const { activity, play, settle } = await setup();
    activity.noteRead(read(A));
    await settle(6_900);
    expect(play()).not.toBeNull();
    await settle(200);
    expect(play()).toBeNull();
  });
});

describe("changes", () => {
  test("are recorded, heat the file and play in the open editor instead of the diff view", async () => {
    const { state, live, play, settle, change } = await setup();
    change({ path: A, before: OLD_A, after: NEW_A });
    await settle();
    expect(state().changes).toHaveLength(1);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(play()).toMatchObject({ kind: "edit", path: A, stepIndex: 0, created: false, settled: false });
    expect(live.getState().touches[A]).toMatchObject({ edits: 1, lines: 3 });
  });

  test("play a created file as one step", async () => {
    const { play, gateway, settle, change } = await setup();
    gateway.disk.set(NEW, "x\ny\n");
    change({ path: NEW, kind: "create", before: null, after: "x\ny\n" });
    await settle();
    expect(play()).toMatchObject({ kind: "edit", path: NEW, created: true });
  });

  test("record but do not show with follow off and the file closed", async () => {
    const { state, play, settle, change } = await setup();
    state().setFollow(false);
    change({ path: A, before: OLD_A, after: NEW_A });
    await settle();
    expect(state().changes).toHaveLength(1);
    expect(state().active).toBeNull();
    expect(play()).toBeNull();
  });

  test("never play over unsaved edits, which keep the draft", async () => {
    const { state, play, clock, settle, change } = await setup();
    await state().openFile(A);
    clock.now += 20_000;
    state().setDraft(A, "mine");
    change({ path: A, before: OLD_A, after: NEW_A });
    await settle();
    expect(play()).toBeNull();
    expect(state().files[A]).toMatchObject({ draft: "mine", conflict: { kind: "modified" } });
  });

  test("two edits of a waiting file play as one", async () => {
    const { activity, state, play, settle, change } = await setup();
    activity.noteRead(read(B));
    change({ path: A, before: OLD_A, after: "one\nTWO\nthree\n", toolUseId: "t1" });
    change({ path: A, before: "one\nTWO\nthree\n", after: NEW_A, toolUseId: "t2" });
    await settle(1_000);
    expect(state().changes).toHaveLength(2);
    expect(play()).toMatchObject({ kind: "edit", path: A });
    expect(stepsOf(play())).toEqual([2]);
  });

  test("a newer edit of the file cuts short one that is still playing", async () => {
    const { play, settle, change } = await setup({ [A]: Array.from({ length: 80 }, (_, index) => `l${String(index)}\n`).join("") });
    const before = Array.from({ length: 80 }, (_, index) => `l${String(index)}\n`);
    const mid = [...before];
    mid[5] = "x\n";
    mid[40] = "y\n";
    const last = [...mid];
    last[70] = "z\n";
    change({ path: A, before: before.join(""), after: mid.join(""), toolUseId: "t1" });
    await settle(10);
    change({ path: A, before: mid.join(""), after: last.join(""), toolUseId: "t2" });
    await settle(10);
    expect(play()).toMatchObject({ kind: "edit", stepIndex: 0 });
  });
});

describe("typing", () => {
  test("opens the file and shows the text typed so far over it", async () => {
    const { activity, state, play, settle } = await setup();
    activity.noteEditing(editing(A, "T"));
    await settle();
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(play()).toMatchObject({
      kind: "typing",
      path: A,
      created: false,
      edit: { kind: "edit", oldString: "two", text: "T" },
    });
    activity.noteEditing(editing(A, "TWO"));
    await settle();
    expect(play()).toMatchObject({ kind: "typing", edit: { text: "TWO" } });
  });

  test("keeps the same play id while typing so the editor updates in place", async () => {
    const { activity, play, settle } = await setup();
    activity.noteEditing(editing(A, "T"));
    await settle();
    const first = play()?.id;
    activity.noteEditing(editing(A, "TW"));
    await settle();
    expect(play()?.id).toBe(first ?? -1);
  });

  test("holds back queued reads until the edit lands", async () => {
    const { activity, play, settle } = await setup();
    activity.noteEditing(editing(A, "T"));
    await settle();
    activity.noteRead(read(B));
    await settle(5_000);
    expect(play()).toMatchObject({ kind: "typing" });
  });

  test("settles into the edit when the change arrives, which plays at once", async () => {
    const { activity, state, play, settle, change } = await setup();
    activity.noteEditing(editing(A, "TWO"));
    await settle();
    change({ path: A, before: OLD_A, after: NEW_A, toolUseId: "tool-1" });
    await settle();
    expect(play()).toMatchObject({ kind: "edit", path: A, settled: true });
    expect(state().files[A]?.draft).toBe(NEW_A);
    expect(state().changes).toHaveLength(1);
  });

  test("a change that was not typed first plays in full", async () => {
    const { activity, play, settle, change } = await setup();
    activity.noteEditing(editing(A, "TWO"));
    await settle();
    change({ path: B, before: "beta\n", after: "beta\ngamma\n", toolUseId: "other-tool" });
    await settle();
    expect(play()).toMatchObject({ kind: "edit", path: B, settled: false });
  });

  test("types a new file into an empty preview tab", async () => {
    const { activity, state, play, settle } = await setup();
    activity.noteEditing({ toolUseId: "tool-1", path: NEW, kind: "write", oldString: null, text: "export" });
    await settle();
    expect(state().active).toEqual({ kind: "file", path: NEW });
    expect(state().files[NEW]).toMatchObject({ status: "ready", draft: "" });
    expect(play()).toMatchObject({ kind: "typing", created: true, edit: { kind: "write", text: "export" } });
  });

  test("a new file that the tool then refuses leaves no blank tab behind", async () => {
    const { activity, state, play, settle } = await setup();
    activity.noteEditing({ toolUseId: "tool-1", path: NEW, kind: "write", oldString: null, text: "x" });
    await settle();
    activity.endEditing("tool-1");
    expect(play()).toBeNull();
    expect(state().files[NEW]).toBeUndefined();
    expect(state().tabs).not.toContain(NEW);
  });

  test("a denied edit clears the typed text and lets the queue go on", async () => {
    const { activity, play, settle } = await setup();
    activity.noteEditing(editing(A, "T"));
    await settle();
    activity.endEditing("tool-1");
    expect(play()).toBeNull();
    activity.noteRead(read(B));
    await settle();
    expect(play()).toMatchObject({ kind: "read", path: B });
  });

  test("the end of the turn clears the typed text too", async () => {
    const { activity, play, settle } = await setup();
    activity.noteEditing(editing(A, "T"));
    await settle();
    activity.endTurn();
    expect(play()).toBeNull();
  });

  test("a finished tool that produced a change does not undo the settling edit", async () => {
    const { activity, play, settle, change } = await setup();
    activity.noteEditing(editing(A, "TWO"));
    await settle();
    change({ path: A, before: OLD_A, after: NEW_A, toolUseId: "tool-1" });
    activity.endEditing("tool-1");
    await settle();
    expect(play()).toMatchObject({ kind: "edit", settled: true });
  });

  test("shows nothing when follow is off and the file is not open", async () => {
    const { activity, state, play, settle } = await setup();
    state().setFollow(false);
    activity.noteEditing(editing(A, "T"));
    await settle();
    expect(play()).toBeNull();
    activity.noteRead(read(B));
    await settle();
    expect(state().active).toBeNull();
  });

  test("waits while the user is typing, even in a file they have saved", async () => {
    const { activity, state, play, clock, settle } = await setup();
    await state().openFile(A);
    clock.now += 20_000;
    state().setDraft(A, `${OLD_A}more\n`);
    await state().saveFile(A);
    activity.noteEditing(editing(A, "T"));
    await settle();
    expect(play()).toBeNull();
    clock.now += 6_000;
    activity.noteEditing(editing(A, "TW", { toolUseId: "tool-2" }));
    await settle();
    expect(play()).toMatchObject({ kind: "typing" });
  });

  test("ignores files outside the workspace", async () => {
    const { activity, play, settle } = await setup();
    activity.noteEditing(editing("C:/elsewhere/x.ts", "T"));
    await settle();
    expect(play()).toBeNull();
  });
});

describe("turns and replays", () => {
  test("startTurn tells the files store which turn the strip shows", async () => {
    const { activity, state } = await setup();
    activity.startTurn("turn-3");
    expect(state().turnId).toBe("turn-3");
  });

  test("replay opens the file and plays the whole turn's change to it", async () => {
    const { activity, state, play, clock, settle, change } = await setup();
    activity.startTurn("turn-1");
    state().setFollow(false);
    change({ path: A, before: OLD_A, after: "one\nTWO\nthree\n", turnId: "turn-1", toolUseId: "t1" });
    change({ path: A, before: "one\nTWO\nthree\n", after: NEW_A, turnId: "turn-1", toolUseId: "t2" });
    await settle();
    expect(play()).toBeNull();
    clock.now += 60_000;
    activity.replay(A);
    await settle();
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(state().files[A]?.preview).toBe(false);
    expect(stepsOf(play())).toEqual([2]);
  });

  test("replay does nothing for a file the turn did not change", async () => {
    const { activity, play, settle } = await setup();
    activity.startTurn("turn-1");
    activity.replay(A);
    await settle();
    expect(play()).toBeNull();
  });

  test("replay of an older turn's file does nothing once a new turn started", async () => {
    const { activity, play, settle, change } = await setup();
    activity.startTurn("turn-1");
    change({ path: A, before: OLD_A, after: NEW_A, turnId: "turn-1" });
    await settle(10_000);
    activity.startTurn("turn-2");
    activity.replay(A);
    await settle();
    expect(play()).toBeNull();
  });

  test("opening another workspace clears the live view", async () => {
    const { activity, store, live, settle } = await setup();
    activity.noteRead(read(A));
    await settle();
    expect(live.getState().touches[A]).toBeDefined();
    store.getState().resetWorkspace("C:/other");
    expect(live.getState().touches).toEqual({});
    expect(live.getState().play).toBeNull();
    activity.dispose();
  });
});
