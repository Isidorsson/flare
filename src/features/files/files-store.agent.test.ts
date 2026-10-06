import { describe, expect, test } from "bun:test";

import { groupByTurn } from "./timeline";
import { ROOT, agentChange, openedStore } from "./test-support";

const A = `${ROOT}/src/a.ts`;
const B = `${ROOT}/src/b.ts`;
const FILES = { [A]: "old", [B]: "beta" };

describe("applyAgentFileChange", () => {
  test("records an entry with a stable id and a normalized absolute path", async () => {
    const { state } = await openedStore(FILES);
    state().applyAgentFileChange(agentChange({ path: "c:\\proj\\src\\a.ts" }));
    state().applyAgentFileChange(agentChange({ path: B, toolUseId: "tool-2", kind: "create", before: null }));
    expect(state().changes.map((c) => [c.id, c.path, c.kind, c.toolUseId])).toEqual([
      ["change-1", A, "update", "tool-1"],
      ["change-2", B, "create", "tool-2"],
    ]);
    expect(state().changes[0]).toMatchObject({ turnId: "turn-a", before: "old", after: "new" });
  });

  test("resolves workspace-relative agent paths", async () => {
    const { state } = await openedStore(FILES);
    state().applyAgentFileChange(agentChange({ path: "src/a.ts" }));
    expect(state().changes[0]?.path).toBe(A);
  });

  test("returns the recorded entry and leaves the editor to the live view", async () => {
    const { state } = await openedStore(FILES);
    const entry = state().applyAgentFileChange(agentChange());
    expect(state().changes).toEqual([entry]);
    expect(state().active).toBeNull();
  });

  test("with follow off, only records the change", async () => {
    const { state } = await openedStore(FILES);
    state().setFollow(false);
    state().applyAgentFileChange(agentChange());
    expect(state().changes).toHaveLength(1);
    expect(state().active).toBeNull();
  });

  test("a clean open buffer jumps to the agent's content", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    state().applyAgentFileChange(agentChange());
    expect(state().files[A]).toMatchObject({ saved: "new", draft: "new", conflict: null });
  });

  test("a dirty open buffer keeps the draft and records the agent's version as a conflict", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "mine");
    state().applyAgentFileChange(agentChange());
    expect(state().files[A]).toMatchObject({ draft: "mine", conflict: { kind: "modified", content: "new" } });
  });
});

describe("turns and new files", () => {
  test("startTurn records which turn the turn strip shows", async () => {
    const { state } = await openedStore(FILES);
    expect(state().turnId).toBeNull();
    state().startTurn("turn-2");
    expect(state().turnId).toBe("turn-2");
  });

  test("openEmptyPreview opens a blank preview tab for a file that does not exist yet", async () => {
    const { state, gateway } = await openedStore(FILES);
    state().openEmptyPreview(`${ROOT}/src/new.ts`);
    expect(state().active).toEqual({ kind: "file", path: `${ROOT}/src/new.ts` });
    expect(state().files[`${ROOT}/src/new.ts`]).toMatchObject({ status: "ready", saved: "", draft: "", preview: true });
    expect(gateway.reads).toEqual([]);
  });

  test("the blank tab follows the file once the agent has written it", async () => {
    const { state } = await openedStore(FILES);
    const path = `${ROOT}/src/new.ts`;
    state().openEmptyPreview(path);
    state().applyAgentFileChange(agentChange({ path, kind: "create", before: null, after: "export {};\n" }));
    expect(state().files[path]).toMatchObject({ saved: "export {};\n", draft: "export {};\n", conflict: null });
  });
});

describe("timeline", () => {
  test("showChange opens a recorded diff and ignores unknown ids", async () => {
    const { state } = await openedStore(FILES);
    state().setFollow(false);
    state().applyAgentFileChange(agentChange());
    state().showChange("change-9");
    expect(state().active).toBeNull();
    state().showChange("change-1");
    expect(state().active).toEqual({ kind: "diff", changeId: "change-1" });
  });

  test("changes group by turn in order of first appearance", async () => {
    const { state } = await openedStore(FILES);
    state().applyAgentFileChange(agentChange({ turnId: "t1", toolUseId: "1" }));
    state().applyAgentFileChange(agentChange({ turnId: "t2", toolUseId: "2", path: B }));
    state().applyAgentFileChange(agentChange({ turnId: "t1", toolUseId: "3", path: B }));
    const groups = groupByTurn(state().changes);
    expect(groups.map((g) => [g.turnId, g.label, g.entries.map((e) => e.toolUseId)])).toEqual([
      ["t1", "Turn 1", ["1", "3"]],
      ["t2", "Turn 2", ["2"]],
    ]);
  });

  test("a workspace change clears the timeline but keeps the follow preference", async () => {
    const { state, store } = await openedStore(FILES);
    state().setFollow(false);
    state().applyAgentFileChange(agentChange());
    store.getState().resetWorkspace("C:/other");
    expect(state().changes).toEqual([]);
    expect(state().active).toBeNull();
    expect(state().follow).toBe(false);
  });
});

describe("noteAgentFileRead", () => {
  test("with follow on, opens the file as a preview tab", async () => {
    const { state } = await openedStore(FILES);
    await state().noteAgentFileRead(A);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(state().files[A]?.preview).toBe(true);
    await state().noteAgentFileRead(B);
    expect(state().tabs).toEqual([B]);
  });

  test("does nothing with follow off", async () => {
    const { state, gateway } = await openedStore(FILES);
    state().setFollow(false);
    await state().noteAgentFileRead(A);
    expect(state().tabs).toEqual([]);
    expect(gateway.reads).toEqual([]);
  });

  test("ignores files outside the workspace", async () => {
    const { state, gateway } = await openedStore(FILES);
    await state().noteAgentFileRead("C:/Users/me/.claude/notes.md");
    expect(gateway.reads).toEqual([]);
  });

  test("never steals the view from a file with unsaved edits", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    state().setDraft(A, "typing");
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(state().tabs).toEqual([A]);
  });

  test("quietly skips unreadable paths such as directories and missing files", async () => {
    const { state } = await openedStore(FILES);
    await state().noteAgentFileRead(`${ROOT}/src`);
    await state().noteAgentFileRead(`${ROOT}/missing.ts`);
    expect(state().tabs).toEqual([]);
    expect(state().active).toBeNull();
  });

  test("activates an already open file instead of reading it again", async () => {
    const { state, gateway, clock } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    clock.now += 12_000;
    await state().noteAgentFileRead(A);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(gateway.reads).toEqual([A, B]);
  });

  test("does not take the editor for six seconds after the user typed", async () => {
    const { state, clock } = await openedStore(FILES);
    await state().openFile(A);
    clock.now += 20_000;
    state().setDraft(A, "old");
    clock.now += 5_999;
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: A });
    clock.now += 1;
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: B });
  });

  test("does not take the editor for twelve seconds after the user picked a file", async () => {
    const { state, clock } = await openedStore(FILES);
    await state().openFile(A);
    clock.now += 11_999;
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: A });
    clock.now += 1;
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: B });
  });

  test("a quiet agent open does not count as the user picking a file", async () => {
    const { state } = await openedStore(FILES);
    await state().noteAgentFileRead(A);
    await state().noteAgentFileRead(B);
    expect(state().active).toEqual({ kind: "file", path: B });
    expect(state().userActivity).toEqual({ typedAt: null, pickedAt: null });
  });

  test("clicking a tab, a timeline entry or a file counts as picking", async () => {
    const { state, clock } = await openedStore(FILES);
    await state().openFile(A);
    state().setFollow(false);
    state().applyAgentFileChange(agentChange());
    state().setFollow(true);
    clock.now += 20_000;
    state().activateFile(A);
    expect(state().userActivity.pickedAt).toBe(clock.now);
    clock.now += 20_000;
    state().showChange("change-1");
    expect(state().userActivity.pickedAt).toBe(clock.now);
  });

  test("waits for the workspace to be ready", async () => {
    const { state, store } = await openedStore(FILES);
    store.getState().resetWorkspace(ROOT);
    await state().noteAgentFileRead(A);
    expect(state().tabs).toEqual([]);
  });
});
