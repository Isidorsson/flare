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
      ["change-1", A, "modify", "tool-1"],
      ["change-2", B, "create", "tool-2"],
    ]);
    expect(state().changes[0]).toMatchObject({ turnId: "turn-a", before: "old", after: "new" });
  });

  test("resolves workspace-relative agent paths", async () => {
    const { state } = await openedStore(FILES);
    state().applyAgentFileChange(agentChange({ path: "src/a.ts" }));
    expect(state().changes[0]?.path).toBe(A);
  });

  test("with follow on, shows each change in the diff view", async () => {
    const { state } = await openedStore(FILES);
    expect(state().follow).toBe(true);
    state().applyAgentFileChange(agentChange());
    expect(state().active).toEqual({ kind: "diff", changeId: "change-1" });
    state().applyAgentFileChange(agentChange({ path: B, toolUseId: "tool-2" }));
    expect(state().active).toEqual({ kind: "diff", changeId: "change-2" });
  });

  test("with follow off, only records the change", async () => {
    const { state } = await openedStore(FILES);
    state().setFollow(false);
    state().applyAgentFileChange(agentChange());
    expect(state().changes).toHaveLength(1);
    expect(state().active).toBeNull();
  });

  test("follow does not pull the view away from unsaved edits", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(B);
    state().setDraft(B, "typing...");
    state().applyAgentFileChange(agentChange());
    expect(state().active).toEqual({ kind: "file", path: B });
    expect(state().changes).toHaveLength(1);
    state().setDraft(B, "beta");
    state().applyAgentFileChange(agentChange({ toolUseId: "tool-2" }));
    expect(state().active).toEqual({ kind: "diff", changeId: "change-2" });
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

  test("a deletion flags the open buffer", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    state().applyAgentFileChange(agentChange({ kind: "delete", after: null }));
    expect(state().files[A]?.conflict).toEqual({ kind: "deleted" });
  });

  test("a change without captured content leaves open buffers alone", async () => {
    const { state } = await openedStore(FILES);
    await state().openFile(A);
    state().applyAgentFileChange(agentChange({ after: null }));
    expect(state().files[A]).toMatchObject({ saved: "old", conflict: null });
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
    const { state, gateway } = await openedStore(FILES);
    await state().openFile(A);
    await state().openFile(B);
    await state().noteAgentFileRead(A);
    expect(state().active).toEqual({ kind: "file", path: A });
    expect(gateway.reads).toEqual([A, B]);
  });

  test("waits for the workspace to be ready", async () => {
    const { state, store } = await openedStore(FILES);
    store.getState().resetWorkspace(ROOT);
    await state().noteAgentFileRead(A);
    expect(state().tabs).toEqual([]);
  });
});
