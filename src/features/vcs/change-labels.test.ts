import { describe, expect, test } from "bun:test";

import { CHANGE_LABELS, CHANGE_LETTERS, CHANGE_TONES, pluralFiles, pluralize, splitPath, syncSummary } from "./change-labels";
import { changeSchema } from "./vcs-schemas";

describe("change tables", () => {
  test("cover every change with a distinct letter, a label and a tone", () => {
    const changes = changeSchema.options;
    for (const change of changes) {
      expect(CHANGE_LABELS[change]).not.toBe("");
      expect(CHANGE_TONES[change]).toStartWith("text-");
    }
    const letters = changes.map((change) => CHANGE_LETTERS[change]);
    expect(new Set(letters).size).toBe(changes.length);
  });
});

describe("splitPath", () => {
  test("separates the file name from its folder", () => {
    expect(splitPath("src/features/vcs/a.ts")).toEqual({ name: "a.ts", dir: "src/features/vcs" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", dir: "" });
  });
});

describe("plurals", () => {
  test("say one file and two files", () => {
    expect(pluralFiles(1)).toBe("1 file");
    expect(pluralFiles(0)).toBe("0 files");
    expect(pluralize(3, "commit")).toBe("3 commits");
  });
});

describe("syncSummary", () => {
  test("says a branch without an upstream has not been published", () => {
    const summary = syncSummary({ upstream: null, ahead: 0, behind: 0 });
    expect(summary.label).toBe("no upstream");
    expect(summary.detail).toContain("first push");
  });

  test("says a branch in step with its upstream is synced", () => {
    expect(syncSummary({ upstream: "origin/main", ahead: 0, behind: 0 })).toEqual({
      label: "synced",
      detail: "In step with origin/main",
    });
  });

  test("shows only the sides that differ", () => {
    expect(syncSummary({ upstream: "origin/main", ahead: 2, behind: 0 }).label).toBe("↑2");
    expect(syncSummary({ upstream: "origin/main", ahead: 0, behind: 1 }).label).toBe("↓1");
    const both = syncSummary({ upstream: "origin/main", ahead: 2, behind: 1 });
    expect(both.label).toBe("↑2 ↓1");
    expect(both.detail).toBe("2 commits to push, 1 commit to pull (origin/main)");
  });
});
