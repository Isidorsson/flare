import { describe, expect, test } from "bun:test";

import { loadingFile } from "./buffer-model";
import type { OpenFile } from "./files-types";
import { planWatchBatch, type WatchView } from "./watch-plan";
import { batchOf } from "./fake-gateway";

const ROOT = "C:/p";

function readyFile(path: string): OpenFile {
  return { ...loadingFile(path, false), status: "ready" };
}

const view: WatchView = {
  root: ROOT,
  dirs: {
    [ROOT]: { status: "ready", entries: [], truncated: false },
    [`${ROOT}/src`]: { status: "ready", entries: [], truncated: false },
  },
  files: { [`${ROOT}/src/a.ts`]: readyFile(`${ROOT}/src/a.ts`) },
};

describe("planWatchBatch", () => {
  test("creates and removals invalidate the loaded parent directory once", () => {
    const plan = planWatchBatch(
      view,
      batchOf(ROOT, [`${ROOT}/src/x.ts`, "create"], [`${ROOT}/src/y.ts`, "remove"], [`${ROOT}/top.ts`, "create"]),
    );
    expect(plan?.reloadDirs.sort()).toEqual([ROOT, `${ROOT}/src`]);
  });

  test("modifications never invalidate listings, and unloaded directories are skipped", () => {
    const plan = planWatchBatch(view, batchOf(ROOT, [`${ROOT}/src/x.ts`, "modify"], [`${ROOT}/other/z.ts`, "create"]));
    expect(plan?.reloadDirs).toEqual([]);
  });

  test("open files are re-read on create or modify and flagged on remove", () => {
    const a = `${ROOT}/src/a.ts`;
    expect(planWatchBatch(view, batchOf(ROOT, [a, "modify"]))).toMatchObject({ syncFiles: [a], deletedFiles: [] });
    expect(planWatchBatch(view, batchOf(ROOT, [a, "create"]))).toMatchObject({ syncFiles: [a] });
    expect(planWatchBatch(view, batchOf(ROOT, [a, "remove"]))).toMatchObject({ syncFiles: [], deletedFiles: [a] });
  });

  test("normalizes Windows-style paths from the batch", () => {
    const plan = planWatchBatch(view, batchOf("c:\\p", ["c:\\p\\src\\a.ts", "modify"]));
    expect(plan?.syncFiles).toEqual([`${ROOT}/src/a.ts`]);
  });

  test("a rescan reloads everything that is loaded", () => {
    const plan = planWatchBatch(view, { root: ROOT, changes: [], rescan: true });
    expect(plan?.reloadDirs.sort()).toEqual([ROOT, `${ROOT}/src`]);
    expect(plan?.syncFiles).toEqual([`${ROOT}/src/a.ts`]);
  });

  test("batches for another workspace, or while none is open, are rejected", () => {
    expect(planWatchBatch(view, batchOf("C:/other", ["C:/other/a.ts", "modify"]))).toBeNull();
    expect(planWatchBatch({ ...view, root: null }, batchOf(ROOT))).toBeNull();
  });
});
