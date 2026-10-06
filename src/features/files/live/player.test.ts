import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import type { EditAction, ReadAction } from "./action-queue";
import { createFakeScheduler } from "./fake-scheduler";
import type { Play } from "./live-types";
import { ActivityPlayer, type PlayerHost, type PreparedFile } from "./player";

const read = (path: string): ReadAction => ({ kind: "read", path, request: { range: { start: 1, end: 5 }, pattern: null, matchLines: null } });
const edit = (path: string, overrides: Partial<EditAction> = {}): EditAction => ({
  kind: "edit",
  path,
  before: "a\nb\nc\n",
  after: "a\nB\nc\n",
  settled: false,
  forced: false,
  ...overrides,
});

function numbered(count: number, change: Record<number, string> = {}): string {
  return Array.from({ length: count }, (_, index) => `${change[index + 1] ?? `line ${String(index + 1)}`}\n`).join("");
}

function setup(files: Record<string, PreparedFile | null> = {}) {
  const scheduler = createFakeScheduler();
  const plays: (Play | null)[] = [];
  const cleared: number[] = [];
  const prepared: { path: string; forced: boolean }[] = [];
  const host: PlayerHost = {
    prepare: (path, options) => {
      prepared.push({ path, forced: options.forced });
      const file = path in files ? files[path] : { content: "a\nB\nc\n", wasActive: false };
      return Promise.resolve(file ?? null);
    },
    setPlay: (play) => {
      plays.push(play);
    },
    clearPlay: (id) => {
      cleared.push(id);
    },
  };
  const player = new ActivityPlayer(host, scheduler);
  async function flush() {
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
  }
  // Lets pending promises finish, then moves time forward one millisecond at a time so timers can start more work.
  async function settle(ms = 0) {
    await flush();
    for (let elapsed = 0; elapsed < ms; elapsed += 1) {
      scheduler.advance(1);
      await flush();
    }
  }
  const kinds = () => plays.map((play) => (play === null ? "none" : `${play.kind}:${play.path}`));
  return { player, scheduler, plays, cleared, prepared, settle, kinds };
}

let errors: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  errors = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

describe("ActivityPlayer reads", () => {
  test("lights up a read at once, jumping to the file unless it was already open", async () => {
    const { player, plays, settle } = setup({ "a.ts": { content: "x", wasActive: false }, "b.ts": { content: "x", wasActive: true } });
    player.enqueue(read("a.ts"));
    await settle();
    player.enqueue(read("b.ts"));
    await settle(650);
    expect(plays).toMatchObject([
      { kind: "read", path: "a.ts", instantScroll: true },
      { kind: "read", path: "b.ts", instantScroll: false },
    ]);
  });

  test("moves on 380 ms after a read when something is already waiting behind it", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    player.enqueue(read("b.ts"));
    await settle(379);
    expect(kinds()).toEqual(["read:a.ts"]);
    await settle(1);
    expect(kinds()).toEqual(["read:a.ts", "read:b.ts"]);
  });

  test("holds a lone read for 650 ms, so a read that arrives meanwhile waits for it", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    await settle();
    player.enqueue(read("b.ts"));
    await settle(649);
    expect(kinds()).toEqual(["read:a.ts"]);
    await settle(1);
    expect(kinds()).toEqual(["read:a.ts", "read:b.ts"]);
  });

  test("does not start an action by itself once the pause is over", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    await settle(2_000);
    expect(kinds()).toEqual(["read:a.ts"]);
  });

  test("clears a read's highlight after seven seconds", async () => {
    const { player, plays, cleared, settle } = setup();
    player.enqueue(read("a.ts"));
    await settle();
    const id = plays[0]?.id ?? -1;
    await settle(6_999);
    expect(cleared).toEqual([]);
    await settle(1);
    expect(cleared).toEqual([id]);
  });

  test("drops the oldest waiting reads when more than three queue up", async () => {
    const { player, kinds, settle } = setup();
    for (const path of ["r1", "r2", "r3", "r4", "r5", "r6"]) player.enqueue(read(path));
    await settle(5_000);
    expect(kinds()).toEqual(["read:r1", "read:r4", "read:r5", "read:r6"]);
  });

  test("skips a file that cannot be shown without pausing", async () => {
    const { player, kinds, settle } = setup({ "hidden.ts": null });
    player.enqueue(read("hidden.ts"));
    player.enqueue(read("shown.ts"));
    await settle();
    expect(kinds()).toEqual(["read:shown.ts"]);
  });
});

describe("ActivityPlayer edits", () => {
  const spread = numbered(120, { 5: "one", 40: "two", 90: "three" });

  test("plays each step, pausing between them, and clears once everything has faded", async () => {
    const { player, plays, cleared, settle } = setup({ "a.ts": { content: spread, wasActive: true } });
    player.enqueue(edit("a.ts", { before: numbered(120), after: spread }));
    await settle();
    expect(plays.map((play) => (play?.kind === "edit" ? play.stepIndex : -1))).toEqual([0]);
    await settle(760);
    await settle(760);
    expect(plays.map((play) => (play?.kind === "edit" ? play.stepIndex : -1))).toEqual([0, 1, 2]);
    expect(cleared).toEqual([]);
    await settle(8_000 + 38 * 2);
    expect(cleared).toEqual([plays[0]?.id ?? -1]);
  });

  test("clears an edit that was already typed out sooner than a fresh one", async () => {
    const { player, plays, cleared, settle } = setup({ "a.ts": { content: "a\nB\nc\n", wasActive: true } });
    player.enqueue(edit("a.ts", { settled: true }));
    await settle(3_499);
    expect(cleared).toEqual([]);
    await settle(1);
    expect(cleared).toEqual([plays[0]?.id ?? -1]);
  });

  test("keeps one play id across the steps of an edit", async () => {
    const { player, plays, settle } = setup({ "a.ts": { content: spread, wasActive: true } });
    player.enqueue(edit("a.ts", { before: numbered(120), after: spread }));
    await settle(2_000);
    expect(new Set(plays.map((play) => play?.id)).size).toBe(1);
  });

  test("shows a single step when other actions are waiting", async () => {
    const { player, plays, settle } = setup({ "a.ts": { content: spread, wasActive: true } });
    player.enqueue(edit("a.ts", { before: numbered(120), after: spread }));
    player.enqueue(read("other.ts"));
    await settle(2_000);
    const edits = plays.filter((play) => play?.kind === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind === "edit" && edits[0].steps).toHaveLength(1);
  });

  test("moves to the next action 700 ms after the last step, or 300 ms when one waits", async () => {
    const { player, kinds, settle } = setup({ "a.ts": { content: "a\nB\nc\n", wasActive: true } });
    player.enqueue(edit("a.ts"));
    player.enqueue(read("b.ts"));
    await settle(299);
    expect(kinds()).toEqual(["edit:a.ts"]);
    await settle(1);
    expect(kinds()).toEqual(["edit:a.ts", "read:b.ts"]);
  });

  test("plays a created file as one step and labels it created", async () => {
    const { player, plays, settle } = setup({ "n.ts": { content: "x\ny\n", wasActive: false } });
    player.enqueue(edit("n.ts", { before: null, after: "x\ny\n" }));
    await settle();
    expect(plays[0]).toMatchObject({ kind: "edit", created: true, instantScroll: true });
  });

  test("diffs against what the editor holds, not what the change said", async () => {
    const { player, plays, settle } = setup({ "a.ts": { content: "a\nB\nc\nlater\n", wasActive: true } });
    player.enqueue(edit("a.ts"));
    await settle();
    const [play] = plays;
    expect(play?.kind === "edit" && play.steps.map((step) => step.added)).toEqual([2]);
  });

  test("skips a change that left nothing to show, clearing the typed preview if there was one", async () => {
    const { player, kinds, settle } = setup({ "a.ts": { content: "a\nb\nc\n", wasActive: true } });
    player.enqueue(edit("a.ts", { settled: true }));
    player.enqueue(edit("b.ts"));
    await settle();
    expect(kinds()[0]).toBe("none");
  });

  test("asks for a forced open only for forced edits", async () => {
    const { player, prepared, settle } = setup();
    player.enqueue(edit("a.ts", { forced: true }));
    await settle();
    player.enqueue(edit("b.ts"));
    await settle(1_000);
    expect(prepared).toEqual([
      { path: "a.ts", forced: true },
      { path: "b.ts", forced: false },
    ]);
  });
});

describe("ActivityPlayer holding for typing", () => {
  test("pauses the queue until the typed edit is released", async () => {
    const { player, kinds, settle } = setup();
    player.hold("tool-1");
    player.enqueue(read("a.ts"));
    await settle(5_000);
    expect(kinds()).toEqual([]);
    player.release("tool-1");
    await settle();
    expect(kinds()).toEqual(["read:a.ts"]);
  });

  test("lets the settling edit go first and cuts off what was playing", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    await settle();
    player.hold("tool-1");
    player.enqueue(read("b.ts"));
    player.enqueue(edit("c.ts", { settled: true }), { front: true });
    await settle(5_000);
    expect(kinds()).toEqual(["read:a.ts"]);
    player.release("tool-1");
    await settle(2_000);
    expect(kinds()).toEqual(["read:a.ts", "edit:c.ts", "read:b.ts"]);
  });

  test("ignores a release for something it is not holding for", async () => {
    const { player, kinds, settle } = setup();
    player.hold("tool-1");
    player.release("tool-2");
    player.enqueue(read("a.ts"));
    await settle(1_000);
    expect(kinds()).toEqual([]);
  });
});

describe("ActivityPlayer interruptions", () => {
  test("interruptEditOf cuts short an edit of the same file so the newer one plays", async () => {
    const spread = numbered(120, { 5: "one", 40: "two", 90: "three" });
    const { player, plays, settle } = setup({ "a.ts": { content: spread, wasActive: true } });
    player.enqueue(edit("a.ts", { before: numbered(120), after: spread }));
    await settle();
    player.enqueue(edit("a.ts", { before: spread, after: spread }));
    player.interruptEditOf("a.ts");
    await settle(5_000);
    expect(plays.filter((play) => play?.kind === "edit" && play.stepIndex > 0)).toEqual([]);
  });

  test("interruptEditOf leaves reads and other files alone", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    await settle();
    player.interruptEditOf("a.ts");
    player.enqueue(read("b.ts"));
    await settle(649);
    expect(kinds()).toEqual(["read:a.ts"]);
  });

  test("reset forgets everything that was queued or playing", async () => {
    const { player, kinds, settle } = setup();
    player.enqueue(read("a.ts"));
    player.enqueue(read("b.ts"));
    await settle();
    player.reset();
    await settle(5_000);
    expect(kinds()).toEqual(["read:a.ts"]);
  });

  test("logs a failing open and carries on with the next action", async () => {
    const scheduler = createFakeScheduler();
    const plays: (Play | null)[] = [];
    const player = new ActivityPlayer(
      {
        prepare: (path) =>
          path === "bad.ts" ? Promise.reject(new Error("disk on fire")) : Promise.resolve({ content: "x", wasActive: true }),
        setPlay: (play) => {
          plays.push(play);
        },
        clearPlay: () => undefined,
      },
      scheduler,
    );
    player.enqueue(read("bad.ts"));
    player.enqueue(read("good.ts"));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(plays.map((play) => play?.path)).toEqual(["good.ts"]);
  });
});
