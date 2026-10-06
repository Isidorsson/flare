import { describe, expect, test } from "bun:test";

import { ROOT, openedStore } from "./test-support";

const A = `${ROOT}/src/a.ts`;
const B = `${ROOT}/src/b.ts`;
const FILES = { [A]: "alpha\nbeta", [B]: "gamma" };

describe("opening a file at a line", () => {
  test("leaves a reveal request for the resolved path and activates the tab", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile("src/a.ts", { line: 2 });
    expect(state().reveal).toMatchObject({ path: A, line: 2 });
    expect(state().active).toEqual({ kind: "file", path: A });
  });

  test("a request stays until the editor that shows it clears it", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { line: 2 });
    const request = state().reveal;
    expect(request).not.toBeNull();
    state().clearReveal((request?.id ?? 0) + 1);
    expect(state().reveal).toBe(request);
    state().clearReveal(request?.id ?? 0);
    expect(state().reveal).toBeNull();
  });

  test("every request gets its own id, even for the same line", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { line: 1 });
    const first = state().reveal?.id;
    await state().openFile(A, { line: 1 });
    expect(state().reveal?.id).not.toBe(first);
  });

  test("opening without a line drops a request that was never shown", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { line: 2 });
    await state().openFile(B);
    expect(state().reveal).toBeNull();
  });

  test("a quiet agent open leaves the user's request alone", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { line: 2 });
    await state().openFile(B, { preview: true, quiet: true });
    expect(state().reveal).toMatchObject({ path: A, line: 2 });
  });

  test("closing the tab drops its pending request", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A, { line: 2 });
    state().closeFile(A);
    expect(state().reveal).toBeNull();
  });
});
