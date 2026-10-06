import { describe, expect, test } from "bun:test";

import { batchOf, deferred } from "./fake-gateway";
import { isDirty } from "./files-types";
import { FsCommandError, type FileRead } from "./fs-schemas";
import { ROOT, agentChange, openedStore } from "./test-support";

const A = `${ROOT}/src/a.ts`;
const B = `${ROOT}/src/b.ts`;
const C = `${ROOT}/c.ts`;
const FILES = { [A]: "alpha", [B]: "beta", [C]: "gamma" };

describe("opening files", () => {
  test("loads text, activates the tab and pins it", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    expect(state().tabs).toEqual([A]);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(state().files[A]).toMatchObject({ status: "ready", saved: "alpha", draft: "alpha", preview: false });
  });

  test("resolves workspace-relative and backslash paths", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile("src\\a.ts");
    await state().openFile("./c.ts");
    expect(state().tabs).toEqual([A, C]);
  });

  test("a preview open replaces the previous clean preview tab but never a pinned one", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(C);
    await state().openFile(A, { preview: true });
    await state().openFile(B, { preview: true });
    expect(state().tabs).toEqual([C, B]);
    expect(state().files[A]).toBeUndefined();
    expect(state().files[B]?.preview).toBe(true);
  });

  test("reopening a preview tab explicitly pins it", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { preview: true });
    await state().openFile(A);
    expect(state().files[A]?.preview).toBe(false);
    await state().openFile(B, { preview: true });
    expect(state().tabs).toEqual([A, B]);
  });

  test("opening an open file activates it without reading again", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    await state().openFile(A);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(gateway.reads).toEqual([A, B]);
  });

  test("a failed read leaves an error tab that retries on reopen", async () => {
    const { state, gateway } = await openedStore();
    await state().openFile(A);
    expect(state().files[A]).toMatchObject({ status: "error", error: "not_found: a.ts" });
    gateway.disk.set(A, "now here");
    await state().openFile(A);
    expect(state().files[A]).toMatchObject({ status: "ready", saved: "now here", error: null });
  });

  test("rejects relative paths when no workspace is open", async () => {
    const { store } = await openedStore();
    store.getState().resetWorkspace(null);
    const failure = await store.getState().openFile("src/a.ts").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : "").toContain("without an open workspace");
  });

  test("a read that finishes after the workspace changed is dropped", async () => {
    const { store, gateway, state } = await openedStore(FILES);
    const gate = deferred<FileRead>();
    gateway.readFile = () => gate.promise;
    const opening = state().openFile(A);
    store.getState().resetWorkspace("C:/other");
    gate.resolve({ kind: "text", content: "late", size: 4 });
    await opening;
    expect(state().files).toEqual({});
    expect(state().tabs).toEqual([]);
  });
});

describe("closing files", () => {
  test("closing the active tab activates its right neighbour, then the left, then nothing", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    await state().openFile(C);
    state().activateFile(B);
    state().closeFile(B);
    expect(state().active).toEqual({ kind: "file", path: C });
    state().closeFile(C);
    expect(state().active).toEqual({ kind: "file", path: A });
    state().closeFile(A);
    expect(state().active).toBeNull();
    expect(state().files).toEqual({});
  });

  test("closing a background tab keeps the active view", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    state().closeFile(A);
    expect(state().active).toEqual({ kind: "file", path: B });
  });
});

describe("editing and saving", () => {
  test("typing makes the buffer dirty and pins a preview tab", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { preview: true });
    state().setDraft(A, "alpha!");
    const file = state().files[A];
    expect(file && isDirty(file)).toBe(true);
    expect(file?.preview).toBe(false);
    state().setDraft(A, "alpha");
    const reverted = state().files[A];
    expect(reverted && isDirty(reverted)).toBe(false);
  });

  test("saving writes the draft and clears the dirty state", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "changed");
    await state().saveActive();
    expect(gateway.writes).toEqual([{ path: A, content: "changed" }]);
    expect(gateway.disk.get(A)).toBe("changed");
    expect(state().files[A]).toMatchObject({ saved: "changed", draft: "changed", saving: false, error: null });
  });

  test("saving a clean file does nothing", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    await state().saveFile(A);
    expect(gateway.writes).toEqual([]);
  });

  test("saveActive ignores a diff view", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "x");
    state().applyAgentFileChange(agentChange({ path: B }));
    state().showChange("change-1");
    expect(state().active).toEqual({ kind: "diff", changeId: "change-1" });
    await state().saveActive();
    expect(gateway.writes).toEqual([]);
  });

  test("a failed save keeps the draft and reports the error", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "changed");
    gateway.failWrites = "disk full";
    await state().saveFile(A);
    expect(state().files[A]).toMatchObject({ saved: "alpha", draft: "changed", saving: false, error: "disk full" });
  });

  test("typing while a save is in flight leaves the buffer dirty afterwards", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "first");
    gateway.holdWrites = deferred<undefined>();
    const hold = gateway.holdWrites;
    const saving = state().saveFile(A);
    expect(state().files[A]?.saving).toBe(true);
    state().setDraft(A, "first and more");
    hold.resolve(undefined);
    await saving;
    expect(state().files[A]).toMatchObject({ saved: "first", draft: "first and more", saving: false });
    expect(gateway.writes).toEqual([{ path: A, content: "first" }]);
  });

  test("a second save while one is running is ignored", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "x");
    gateway.holdWrites = deferred<undefined>();
    const hold = gateway.holdWrites;
    const first = state().saveFile(A);
    const second = state().saveFile(A);
    hold.resolve(undefined);
    await Promise.all([first, second]);
    expect(gateway.writes).toHaveLength(1);
  });
});

describe("external changes from the watcher", () => {
  test("a clean open file is refreshed in place", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.disk.set(A, "edited elsewhere");
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    expect(state().files[A]).toMatchObject({ saved: "edited elsewhere", draft: "edited elsewhere", conflict: null });
  });

  test("a dirty open file keeps the draft and flags a conflict", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "mine");
    gateway.disk.set(A, "theirs");
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    expect(state().files[A]).toMatchObject({ draft: "mine", saved: "alpha", conflict: { kind: "modified", content: "theirs" } });
  });

  test("the echo of our own save is not a conflict", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "mine");
    await state().saveFile(A);
    state().setDraft(A, "mine, then more");
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    expect(gateway.disk.get(A)).toBe("mine");
    expect(state().files[A]).toMatchObject({ draft: "mine, then more", conflict: null });
  });

  test("overwriting resolves a conflict", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "mine");
    gateway.disk.set(A, "theirs");
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    await state().saveFile(A);
    expect(gateway.disk.get(A)).toBe("mine");
    expect(state().files[A]).toMatchObject({ conflict: null, saved: "mine" });
  });

  test("reloading discards the draft and takes the disk content", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "mine");
    gateway.disk.set(A, "theirs");
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    await state().reloadFile(A);
    expect(state().files[A]).toMatchObject({ draft: "theirs", saved: "theirs", conflict: null });
  });

  test("removal flags the file as deleted and recreation restores it", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.disk.delete(A);
    await state().applyWatchBatch(batchOf(ROOT, [A, "remove"]));
    expect(state().files[A]).toMatchObject({ draft: "alpha", conflict: { kind: "deleted" } });
    gateway.disk.set(A, "back");
    await state().applyWatchBatch(batchOf(ROOT, [A, "create"]));
    expect(state().files[A]).toMatchObject({ draft: "back", saved: "back", conflict: null });
  });

  test("saving a deleted file recreates it", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.disk.delete(A);
    await state().applyWatchBatch(batchOf(ROOT, [A, "remove"]));
    await state().saveFile(A);
    expect(gateway.disk.get(A)).toBe("alpha");
    expect(state().files[A]?.conflict).toBeNull();
  });

  test("a file that vanishes before the refresh read becomes deleted", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.disk.delete(A);
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    expect(state().files[A]?.conflict).toEqual({ kind: "deleted" });
  });

  test("other read failures are reported on the file", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.readFile = () => Promise.reject(new FsCommandError("io", "access denied"));
    await state().applyWatchBatch(batchOf(ROOT, [A, "modify"]));
    expect(state().files[A]).toMatchObject({ status: "ready", error: "access denied" });
  });

  test("a batch for another workspace is ignored", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    gateway.disk.set(A, "changed");
    await state().applyWatchBatch(batchOf("C:/elsewhere", [A, "modify"]));
    expect(state().files[A]?.draft).toBe("alpha");
  });

  test("files that are not open are not read", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().applyWatchBatch(batchOf(ROOT, [B, "modify"]));
    expect(gateway.reads).toEqual([]);
  });

  test("a rescan re-reads every open file", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    gateway.disk.set(A, "a2");
    gateway.disk.set(B, "b2");
    await state().applyWatchBatch({ root: ROOT, changes: [], rescan: true });
    expect(state().files[A]?.draft).toBe("a2");
    expect(state().files[B]?.draft).toBe("b2");
  });
});
