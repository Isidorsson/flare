import { describe, expect, test } from "bun:test";

import { afterSave, fromRead, loadingFile, reconcileDisk } from "./buffer-model";
import type { OpenFile } from "./files-types";

function ready(saved: string, draft = saved): OpenFile {
  return { ...loadingFile("C:/p/a.ts", false), status: "ready", saved, draft };
}

describe("fromRead", () => {
  test("loads text into both saved and draft", () => {
    const file = fromRead(loadingFile("C:/p/a.ts", true), { kind: "text", content: "hi", size: 2 });
    expect(file).toMatchObject({ status: "ready", saved: "hi", draft: "hi", preview: true, conflict: null });
  });

  test("keeps binary and oversized files out of the editor", () => {
    const base = loadingFile("C:/p/a.bin", false);
    expect(fromRead(base, { kind: "binary", size: 4 })).toMatchObject({ status: "binary", draft: "" });
    expect(fromRead(base, { kind: "tooLarge", size: 9, limit: 3 })).toMatchObject({ status: "tooLarge" });
  });
});

describe("reconcileDisk", () => {
  test("a clean buffer follows the disk", () => {
    expect(reconcileDisk(ready("a"), "b")).toMatchObject({ saved: "b", draft: "b", conflict: null });
  });

  test("a dirty buffer keeps its draft and records the disk change as a conflict", () => {
    const result = reconcileDisk(ready("a", "mine"), "theirs");
    expect(result).toMatchObject({ saved: "a", draft: "mine", conflict: { kind: "modified", content: "theirs" } });
  });

  test("a dirty buffer whose disk content equals the draft becomes clean", () => {
    expect(reconcileDisk(ready("a", "same"), "same")).toMatchObject({ saved: "same", draft: "same", conflict: null });
  });

  test("an unchanged disk clears a stale conflict", () => {
    const conflicted: OpenFile = { ...ready("a", "mine"), conflict: { kind: "modified", content: "x" } };
    expect(reconcileDisk(conflicted, "a").conflict).toBeNull();
  });

  test("deletion is flagged without touching the content", () => {
    expect(reconcileDisk(ready("a", "mine"), null)).toMatchObject({ draft: "mine", conflict: { kind: "deleted" } });
  });

  test("recreating a deleted clean file restores it", () => {
    const deleted = reconcileDisk(ready("a"), null);
    expect(reconcileDisk(deleted, "back")).toMatchObject({ saved: "back", draft: "back", conflict: null });
  });

  test("ignores disk updates while a save is in flight and for non-text buffers", () => {
    const saving: OpenFile = { ...ready("a", "mine"), saving: true };
    expect(reconcileDisk(saving, "theirs")).toBe(saving);
    const binary = fromRead(loadingFile("C:/p/a.bin", false), { kind: "binary", size: 1 });
    expect(reconcileDisk(binary, "text")).toBe(binary);
  });
});

describe("afterSave", () => {
  test("marks the written content as saved and resolves conflicts", () => {
    const conflicted: OpenFile = { ...ready("a", "mine"), saving: true, conflict: { kind: "deleted" }, preview: true };
    expect(afterSave(conflicted, "mine")).toMatchObject({
      saved: "mine",
      draft: "mine",
      saving: false,
      conflict: null,
      preview: false,
    });
  });

  test("stays dirty when the draft moved on during the write", () => {
    const file: OpenFile = { ...ready("a", "mine and more"), saving: true };
    const saved = afterSave(file, "mine");
    expect(saved.saved).toBe("mine");
    expect(saved.draft).toBe("mine and more");
  });
});
