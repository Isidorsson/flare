import { describe, expect, test } from "bun:test";

import {
  conflictCount,
  discardBlockedReason,
  discardPaths,
  groupFiles,
  reconcileSelection,
  stagePaths,
  unstagePaths,
} from "./change-groups";
import { file } from "./fake-gateway";
import type { ChangeRow } from "./vcs-types";

describe("groupFiles", () => {
  test("puts a staged file under Staged and an edited one under Changes", () => {
    const groups = groupFiles([file("a.ts", "modified", null), file("b.ts", null, "modified")]);
    expect(groups.staged.map((row) => row.path)).toEqual(["a.ts"]);
    expect(groups.unstaged.map((row) => row.path)).toEqual(["b.ts"]);
  });

  test("a partly staged file is in both lists, each with its own change", () => {
    const groups = groupFiles([file("a.ts", "added", "modified")]);
    expect(groups.staged).toEqual([{ path: "a.ts", origPath: null, change: "added", staged: true }]);
    expect(groups.unstaged).toEqual([{ path: "a.ts", origPath: null, change: "modified", staged: false }]);
  });

  test("an untracked file is under Changes only", () => {
    const groups = groupFiles([file("n.md", null, "untracked")]);
    expect(groups.staged).toEqual([]);
    expect(groups.unstaged[0]?.change).toBe("untracked");
  });

  test("a conflicted file is listed once, under Changes, whichever side git reports it on", () => {
    for (const conflicted of [file("c.ts", null, "conflicted"), file("c.ts", "conflicted", null), file("c.ts", "conflicted", "conflicted")]) {
      const groups = groupFiles([conflicted]);
      expect(groups.staged).toEqual([]);
      expect(groups.unstaged).toEqual([{ path: "c.ts", origPath: null, change: "conflicted", staged: false }]);
    }
  });

  test("keeps the old path of a staged rename and drops it for other changes", () => {
    const groups = groupFiles([file("new.ts", "renamed", "modified", "old.ts")]);
    expect(groups.staged[0]).toMatchObject({ change: "renamed", origPath: "old.ts" });
    expect(groups.unstaged[0]).toMatchObject({ change: "modified", origPath: null });
  });

  test("keeps git's order and handles an empty status", () => {
    expect(groupFiles([])).toEqual({ staged: [], unstaged: [] });
    const groups = groupFiles([file("z.ts", "modified", null), file("a.ts", "modified", null)]);
    expect(groups.staged.map((row) => row.path)).toEqual(["z.ts", "a.ts"]);
  });
});

function row(path: string, change: ChangeRow["change"], origPath: string | null = null): ChangeRow {
  return { path, origPath, change, staged: false };
}

describe("paths for an action", () => {
  test("staging sends each path once", () => {
    expect(stagePaths([row("a", "modified"), row("b", "untracked")])).toEqual(["a", "b"]);
  });

  test("unstaging a rename sends both paths so the old one does not stay staged as a deletion", () => {
    expect(unstagePaths([row("new", "renamed", "old"), row("b", "modified")])).toEqual(["new", "old", "b"]);
  });

  test("discarding skips untracked and conflicted files", () => {
    const rows = [row("a", "modified"), row("n", "untracked"), row("c", "conflicted"), row("d", "deleted")];
    expect(discardPaths(rows)).toEqual(["a", "d"]);
  });
});

describe("discardBlockedReason", () => {
  test("explains why an untracked or conflicted file cannot be discarded and allows the rest", () => {
    expect(discardBlockedReason("untracked")).toContain("does not track");
    expect(discardBlockedReason("conflicted")).toContain("conflict");
    for (const change of ["added", "modified", "deleted", "renamed", "typeChanged"] as const) {
      expect(discardBlockedReason(change)).toBeNull();
    }
  });
});

describe("conflictCount", () => {
  test("counts conflicted rows", () => {
    expect(conflictCount([row("a", "conflicted"), row("b", "modified"), row("c", "conflicted")])).toBe(2);
  });
});

describe("reconcileSelection", () => {
  test("keeps a selection that is still listed where it was", () => {
    const selection = { path: "a.ts", staged: false };
    expect(reconcileSelection(selection, [file("a.ts", null, "modified")])).toBe(selection);
  });

  test("follows a file that moved to the other list, such as after staging it", () => {
    expect(reconcileSelection({ path: "a.ts", staged: false }, [file("a.ts", "modified", null)])).toEqual({
      path: "a.ts",
      staged: true,
    });
    expect(reconcileSelection({ path: "a.ts", staged: true }, [file("a.ts", null, "modified")])).toEqual({
      path: "a.ts",
      staged: false,
    });
  });

  test("stays on the same side when the file is in both", () => {
    const both = [file("a.ts", "modified", "modified")];
    expect(reconcileSelection({ path: "a.ts", staged: true }, both)).toEqual({ path: "a.ts", staged: true });
    expect(reconcileSelection({ path: "a.ts", staged: false }, both)).toEqual({ path: "a.ts", staged: false });
  });

  test("drops a file that is no longer changed, and has nothing to do without a selection", () => {
    expect(reconcileSelection({ path: "gone.ts", staged: false }, [file("a.ts", null, "modified")])).toBeNull();
    expect(reconcileSelection(null, [file("a.ts", null, "modified")])).toBeNull();
  });
});
