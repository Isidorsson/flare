import { describe, expect, test } from "bun:test";

import { batchOf, deferred } from "./fake-gateway";
import type { DirListing } from "./fs-schemas";
import { flattenTree } from "./tree-rows";
import { ROOT, openedStore } from "./test-support";

const FILES = {
  [`${ROOT}/src/a.ts`]: "a",
  [`${ROOT}/src/lib/deep.ts`]: "d",
  [`${ROOT}/readme.md`]: "r",
};

function names(rows: ReturnType<typeof flattenTree>): string[] {
  return rows.map((row) => (row.type === "entry" ? `${"  ".repeat(row.depth)}${row.entry.name}` : `(${row.text})`));
}

describe("workspace lifecycle", () => {
  test("opening loads the root listing and marks the workspace ready", async () => {
    const { state } = await openedStore(FILES);
    expect(state().phase).toBe("ready");
    expect(state().root).toBe(ROOT);
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toEqual(["src", "readme.md"]);
  });

  test("resetting to no workspace clears everything", async () => {
    const { state, store } = await openedStore(FILES);
    await state().toggleDir(`${ROOT}/src`);
    await state().openFile(`${ROOT}/readme.md`);
    store.getState().resetWorkspace(null);
    expect(state()).toMatchObject({ phase: "idle", root: null, dirs: {}, expanded: {}, files: {}, tabs: [], active: null });
  });

  test("a failed open is recorded", async () => {
    const { state, store } = await openedStore(FILES);
    store.getState().resetWorkspace("C:/nope");
    expect(state().phase).toBe("opening");
    store.getState().workspaceFailed("not found: C:/nope");
    expect(state()).toMatchObject({ phase: "error", workspaceError: "not found: C:/nope" });
  });

  test("a listing that arrives after a workspace switch is dropped", async () => {
    const { state, store, gateway } = await openedStore(FILES);
    const gate = deferred<DirListing>();
    gateway.listDir = () => gate.promise;
    const loading = state().toggleDir(`${ROOT}/src`);
    store.getState().resetWorkspace("C:/other");
    gate.resolve({ entries: [], truncated: false });
    await loading;
    expect(state().dirs).toEqual({});
  });
});

describe("lazy expansion", () => {
  test("lists a folder only when it is first expanded", async () => {
    const { state, gateway } = await openedStore(FILES);
    expect(gateway.lists).toEqual([ROOT]);
    await state().toggleDir(`${ROOT}/src`);
    expect(gateway.lists).toEqual([ROOT, `${ROOT}/src`]);
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toEqual(["src", "  lib", "  a.ts", "readme.md"]);
  });

  test("collapsing hides the children and re-expanding reuses the listing", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().toggleDir(`${ROOT}/src`);
    await state().toggleDir(`${ROOT}/src`);
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toEqual(["src", "readme.md"]);
    await state().toggleDir(`${ROOT}/src`);
    expect(gateway.lists).toEqual([ROOT, `${ROOT}/src`]);
  });

  test("a failing listing shows an error row", async () => {
    const { state, gateway } = await openedStore(FILES);
    gateway.listDir = () => Promise.reject(new Error("permission denied"));
    await state().toggleDir(`${ROOT}/src`);
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toEqual(["src", "(permission denied)", "readme.md"]);
  });
});

describe("tree refresh from the watcher", () => {
  test("a created file refreshes the loaded parent directory", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().toggleDir(`${ROOT}/src`);
    gateway.disk.set(`${ROOT}/src/new.ts`, "n");
    await state().applyWatchBatch(batchOf(ROOT, [`${ROOT}/src/new.ts`, "create"]));
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toContain("  new.ts");
  });

  test("a removed file disappears from its directory", async () => {
    const { state, gateway } = await openedStore(FILES);
    gateway.disk.delete(`${ROOT}/readme.md`);
    await state().applyWatchBatch(batchOf(ROOT, [`${ROOT}/readme.md`, "remove"]));
    expect(names(flattenTree(ROOT, state().dirs, state().expanded))).toEqual(["src"]);
  });

  test("plain modifications and unloaded directories cause no listing calls", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().applyWatchBatch(
      batchOf(ROOT, [`${ROOT}/readme.md`, "modify"], [`${ROOT}/src/new.ts`, "create"]),
    );
    expect(gateway.lists).toEqual([ROOT]);
  });

  test("a rescan reloads every loaded directory", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().toggleDir(`${ROOT}/src`);
    await state().applyWatchBatch({ root: ROOT, changes: [], rescan: true });
    expect(gateway.lists).toEqual([ROOT, `${ROOT}/src`, ROOT, `${ROOT}/src`]);
  });
});

describe("flattenTree", () => {
  test("shows loading, truncation and empty-folder rows", () => {
    expect(names(flattenTree("C:/p", {}, {}))).toEqual(["(Loading...)"]);
    const truncated = { "C:/p": { status: "ready" as const, entries: [], truncated: true } };
    expect(names(flattenTree("C:/p", truncated, {}))).toEqual(["(Showing the first entries only)", "(Empty folder)"]);
  });
});
