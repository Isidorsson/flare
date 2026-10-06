import { describe, expect, spyOn, test } from "bun:test";

import type { CheckpointGateway } from "./checkpoint-gateway";
import type { RestoreResult, Snapshot } from "./checkpoint-schemas";
import { createCheckpointStore } from "./checkpoint-store";
import type { RestoreTarget, TurnContext } from "./checkpoint-types";
import { createFakeGateway, deferred, snapshot, DEFAULT_PLAN } from "./fake-gateway";

const CONTEXT: TurnContext = { threadId: "thread-1", sessionId: "s1", root: "C:/work", anchorItemId: "item-0" };

function setup(overrides: Partial<CheckpointGateway> = {}) {
  const fake = createFakeGateway(overrides);
  let ids = 0;
  const store = createCheckpointStore({
    gateway: fake.gateway,
    now: () => 1_700_000_000_000,
    createId: () => `record-${String((ids += 1))}`,
  });
  return {
    store,
    calls: fake.calls,
    state: () => store.getState(),
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
}

function targetFor(request: RestoreTarget["request"]): RestoreTarget {
  return { threadId: "thread-1", sessionId: "s1", root: "C:/work", request };
}

const UNDO_TURN_1 = targetFor({ kind: "undoTurn", turn: 1 });

describe("recording a turn", () => {
  test("snapshots at the start and end of a turn and lists the files it changed", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().startTurn(CONTEXT);
    expect(state().records[0]).toMatchObject({ status: "open", turn: null, anchorItemId: "item-0" });
    await settle();
    expect(state().records[0]?.turn).toBe(1);

    store.getState().endTurn();
    expect(state().records[0]?.status).toBe("closing");
    await settle();

    expect(calls).toEqual(["create start", "create end 1", "diff 1"]);
    expect(state().records[0]).toMatchObject({
      status: "ready",
      turn: 1,
      added: 2,
      removed: 1,
      files: [{ path: "src/a.ts", status: "modified", added: 2, removed: 1 }],
    });
  });

  test("an end waits for its start snapshot, so it knows the turn number", async () => {
    const start = deferred<Snapshot>();
    const { store, calls, state, settle } = setup({
      create: (input) => (input.phase === "start" ? start.promise : Promise.resolve(snapshot(input.turn, "end"))),
    });
    store.getState().startTurn(CONTEXT);
    store.getState().endTurn();
    await settle();
    expect(calls).toEqual(["create start"]);

    start.resolve(snapshot(4, "start"));
    await settle();

    expect(calls).toEqual(["create start", "create end 4", "diff 4"]);
    expect(state().records[0]?.status).toBe("ready");
  });

  test("a second trigger for a turn already being recorded is ignored", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().startTurn(CONTEXT);
    store.getState().startTurn({ ...CONTEXT, anchorItemId: "item-5" });
    await settle();

    expect(calls).toEqual(["create start"]);
    expect(state().records).toHaveLength(1);
    expect(state().records[0]?.anchorItemId).toBe("item-0");
  });

  test("the same thread can start again once its turn has ended", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().startTurn(CONTEXT);
    store.getState().endTurn();
    store.getState().startTurn({ ...CONTEXT, anchorItemId: "item-5" });
    await settle();

    expect(calls).toEqual(["create start", "create end 1", "diff 1", "create start"]);
    expect(state().records.map((record) => record.turn)).toEqual([1, 2]);
  });

  test("a turn that starts in another thread closes the one that is open", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().startTurn(CONTEXT);
    store.getState().startTurn({ ...CONTEXT, threadId: "thread-2", sessionId: "thread-2" });
    await settle();

    expect(calls).toEqual(["create start", "create end 1", "diff 1", "create start"]);
    expect(state().records.map((record) => record.status)).toEqual(["ready", "open"]);
  });

  test("ending when no turn is open does nothing", async () => {
    const { store, calls, settle } = setup();
    store.getState().endTurn();
    await settle();
    expect(calls).toEqual([]);
  });

  test("a failed start snapshot marks the turn failed, tells the user, and skips the end snapshot", async () => {
    const { store, calls, state, settle } = setup({ create: () => Promise.reject(new Error("git is not installed")) });
    store.getState().startTurn(CONTEXT);
    store.getState().endTurn();
    await settle();

    expect(calls).toEqual(["create start"]);
    expect(state().records[0]).toMatchObject({ status: "failed", error: "git is not installed" });
    expect(state().notice?.tone).toBe("error");
    expect(state().notice?.message).toContain("git is not installed");
  });

  test("a failed end snapshot marks the turn failed", async () => {
    const { store, state, settle } = setup({
      create: (input) => (input.phase === "start" ? Promise.resolve(snapshot(1, "start")) : Promise.reject(new Error("disk full"))),
    });
    store.getState().startTurn(CONTEXT);
    store.getState().endTurn();
    await settle();

    expect(state().records[0]).toMatchObject({ status: "failed", error: "disk full" });
  });

  test("files git could not read are kept on the turn", async () => {
    const { store, state, settle } = setup({
      create: (input) =>
        Promise.resolve(input.phase === "start" ? snapshot(1, "start", ["locked.db"]) : snapshot(input.turn, "end", ["other.db"])),
    });
    store.getState().startTurn(CONTEXT);
    store.getState().endTurn();
    await settle();

    expect(state().records[0]?.warnings).toEqual(["locked.db", "other.db"]);
  });

  test("a new turn clears the previous notice", () => {
    const { store, state } = setup();
    store.getState().reportUnavailable("no session id");
    expect(state().notice?.tone).toBe("error");
    store.getState().startTurn(CONTEXT);
    expect(state().notice).toBeNull();
  });

  test("reporting that checkpoints are unavailable says why", () => {
    const { store, state } = setup();
    store.getState().reportUnavailable("the session has no id yet");
    expect(state().notice?.message).toBe("Undo is unavailable for this turn: the session has no id yet");
  });
});

describe("pruning", () => {
  test("clears old checkpoints once per workspace", async () => {
    const { store, calls, settle } = setup();
    store.getState().pruneWorkspace("C:/work");
    store.getState().pruneWorkspace("C:/work");
    store.getState().pruneWorkspace("C:/other");
    await settle();
    expect(calls).toEqual(["prune C:/work", "prune C:/other"]);
  });

  test("a failed prune is logged and does not bother the user", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const { store, state, settle } = setup({ prune: () => Promise.reject(new Error("folder is gone")) });
    store.getState().pruneWorkspace("C:/gone");
    await settle();
    expect(state().notice).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

describe("undoing a turn", () => {
  test("shows the files, then restores them on confirmation and offers a redo", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().requestRestore(UNDO_TURN_1);
    expect(state().pending).toMatchObject({ status: "planning", files: [] });
    await settle();
    expect(state().pending).toMatchObject({ status: "ready", files: DEFAULT_PLAN });

    store.getState().confirmRestore();
    expect(state().pending?.status).toBe("restoring");
    expect(state().restoring).toBe(true);
    await settle();

    expect(calls).toEqual(["plan undoTurn 1", "restore undoTurn 1 force=false"]);
    expect(state().pending).toBeNull();
    expect(state().restoring).toBe(false);
    expect(state().notice).toMatchObject({
      tone: "info",
      message: "Turn undone: 1 file put back",
      action: { label: "Redo", target: { request: { kind: "redo", restore: 1 } } },
    });
  });

  test("files edited after the turn are overwritten only because the user confirmed them", async () => {
    const edited = [{ path: "src/a.ts", action: "revert" as const, conflict: true }];
    const { store, calls, state, settle } = setup({ plan: () => Promise.resolve({ files: edited }) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    expect(state().pending?.files).toEqual(edited);

    store.getState().confirmRestore();
    await settle();

    expect(calls).toEqual(["plan undoTurn 1", "restore undoTurn 1 force=true"]);
  });

  test("conflicts that appear after the plan send the user back to the list instead of overwriting", async () => {
    const late: RestoreResult = {
      status: "conflicts",
      files: [{ path: "src/a.ts", action: "revert", conflict: true }],
    };
    const { store, calls, state, settle } = setup({ restore: () => Promise.resolve(late) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    expect(calls).toEqual(["plan undoTurn 1", "restore undoTurn 1 force=false"]);
    expect(state().pending).toMatchObject({ status: "ready", files: late.files });
    expect(state().notice).toBeNull();
    expect(state().restoring).toBe(false);
  });

  test("nothing to undo is reported without a question", async () => {
    const { store, state, settle } = setup({ plan: () => Promise.resolve({ files: [] }) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();

    expect(state().pending).toBeNull();
    expect(state().notice?.message).toBe("Nothing to change: the files already match.");
  });

  test("a restore that finds nothing to change says so", async () => {
    const { store, state, settle } = setup({ restore: () => Promise.resolve({ status: "unchanged" }) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    expect(state().pending).toBeNull();
    expect(state().notice?.action).toBeNull();
  });

  test("a failed plan is reported and nothing is asked", async () => {
    const { store, state, settle } = setup({ plan: () => Promise.reject(new Error("not a repository")) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();

    expect(state().pending).toBeNull();
    expect(state().notice).toMatchObject({
      tone: "error",
      message: "Could not check what would change: not a repository",
    });
  });

  test("a failed restore is reported and the buttons come back", async () => {
    const { store, state, settle } = setup({ restore: () => Promise.reject(new Error("access denied")) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    expect(state().pending).toBeNull();
    expect(state().restoring).toBe(false);
    expect(state().notice).toMatchObject({ tone: "error", message: "Could not restore the files: access denied" });
  });

  test("cancelling closes the question without restoring", async () => {
    const { store, calls, state, settle } = setup();
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().cancelRestore();

    expect(state().pending).toBeNull();
    expect(calls).toEqual(["plan undoTurn 1"]);
  });

  test("a plan that finishes after the user cancelled does not bring the question back", async () => {
    const plan = deferred<{ files: typeof DEFAULT_PLAN }>();
    const { store, state, settle } = setup({ plan: () => plan.promise });
    store.getState().requestRestore(UNDO_TURN_1);
    store.getState().cancelRestore();
    plan.resolve({ files: DEFAULT_PLAN });
    await settle();

    expect(state().pending).toBeNull();
  });

  test("cannot be cancelled while files are being written", async () => {
    const restore = deferred<RestoreResult>();
    const { store, state, settle } = setup({ restore: () => restore.promise });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    store.getState().cancelRestore();
    expect(state().pending?.status).toBe("restoring");

    restore.resolve({ status: "restored", restore: 2, files: DEFAULT_PLAN, warnings: [] });
    await settle();
    expect(state().pending).toBeNull();
  });

  test("only one restore at a time", async () => {
    const { store, calls, settle } = setup();
    store.getState().requestRestore(UNDO_TURN_1);
    store.getState().requestRestore(targetFor({ kind: "restoreBefore", turn: 2 }));
    await settle();
    expect(calls).toEqual(["plan undoTurn 1"]);
  });

  test("confirming does nothing before the plan is ready", () => {
    const { store, calls } = setup({ plan: () => new Promise(() => undefined) });
    store.getState().requestRestore(UNDO_TURN_1);
    store.getState().confirmRestore();
    expect(calls).toEqual(["plan undoTurn 1"]);
  });
});

describe("rolling back and redoing", () => {
  test("rolling back to before a turn uses its own wording", async () => {
    const { store, state, settle } = setup();
    store.getState().requestRestore(targetFor({ kind: "restoreBefore", turn: 2 }));
    await settle();
    store.getState().confirmRestore();
    await settle();

    expect(state().notice?.message).toBe("Rolled back: 1 file put back");
  });

  test("redo runs straight away and offers to undo again", async () => {
    const { store, calls, state, settle } = setup({
      restore: (input) =>
        Promise.resolve({
          status: "restored",
          restore: input.request.kind === "redo" ? 2 : 1,
          files: DEFAULT_PLAN,
          warnings: [],
        }),
    });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    store.getState().runNoticeAction();
    expect(state().notice).toBeNull();
    await settle();

    expect(calls.at(-1)).toBe("restore redo 1 force=false");
    expect(state().notice).toMatchObject({
      message: "Redone: 1 file changed",
      action: { label: "Undo again", target: { request: { kind: "redo", restore: 2 } } },
    });
  });

  test("a redo that meets edits made since asks first", async () => {
    const conflicts: RestoreResult = { status: "conflicts", files: [{ path: "a.ts", action: "revert", conflict: true }] };
    let answer: RestoreResult = { status: "restored", restore: 1, files: DEFAULT_PLAN, warnings: [] };
    const { store, state, settle } = setup({ restore: () => Promise.resolve(answer) });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    answer = conflicts;
    store.getState().runNoticeAction();
    await settle();

    expect(state().pending).toMatchObject({
      status: "ready",
      files: conflicts.files,
      target: { request: { kind: "redo", restore: 1 } },
    });
  });

  test("warnings from a restore are shown with its notice", async () => {
    const { store, state, settle } = setup({
      restore: () =>
        Promise.resolve({ status: "restored", restore: 1, files: DEFAULT_PLAN, warnings: ["could not remove C:/work/empty"] }),
    });
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();

    expect(state().notice?.detail).toBe("could not remove C:/work/empty");
  });

  test("the notice action is ignored while a question is open or files are being written", async () => {
    const { store, calls, settle } = setup();
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();
    store.getState().requestRestore(targetFor({ kind: "undoTurn", turn: 2 }));
    store.getState().runNoticeAction();
    await settle();

    expect(calls.filter((call) => call.startsWith("restore"))).toEqual(["restore undoTurn 1 force=false"]);
  });

  test("dismissing the notice removes it", async () => {
    const { store, state, settle } = setup();
    store.getState().requestRestore(UNDO_TURN_1);
    await settle();
    store.getState().confirmRestore();
    await settle();
    store.getState().dismissNotice();
    expect(state().notice).toBeNull();
  });
});
