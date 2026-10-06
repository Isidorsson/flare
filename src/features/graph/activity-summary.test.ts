import { describe, expect, test } from "bun:test";

import { folderActivity, hudStats, recentlyTouched } from "./activity-summary";
import type { NodeActivity } from "./activity-state";

function activity(overrides: Partial<NodeActivity>): NodeActivity {
  return { reads: 0, edits: 0, linesChanged: 0, lastKind: "read", lastTouchedAt: 0, changedTurn: null, ...overrides };
}

const NODES = new Map<string, NodeActivity>([
  ["src/a.ts", activity({ reads: 2, edits: 1, lastTouchedAt: 900 })],
  ["src/b.ts", activity({ reads: 1, lastTouchedAt: 500 })],
  ["lib/c.ts", activity({ reads: 3, lastTouchedAt: 100 })],
  ["lib/disk.ts", activity({ lastTouchedAt: 950 })],
]);

describe("hudStats", () => {
  test("counts visited, edited and read-only files", () => {
    expect(hudStats(NODES, 21, 29)).toEqual({ files: 29, visited: 3, edited: 1, readOnly: 2, turnLines: 21 });
  });

  test("starts at zero for a quiet session", () => {
    expect(hudStats(new Map(), 0, 5)).toEqual({ files: 5, visited: 0, edited: 0, readOnly: 0, turnLines: 0 });
  });
});

describe("folderActivity", () => {
  test("groups visits by the hub that owns each file", () => {
    const hubs = folderActivity(NODES, (id) => id.split("/")[0] ?? null);
    expect(hubs.get("src")).toEqual({ edited: 1, readOnly: 1 });
    expect(hubs.get("lib")).toEqual({ edited: 0, readOnly: 1 });
  });

  test("skips files that no hub owns", () => {
    expect(folderActivity(NODES, () => null).size).toBe(0);
  });
});

describe("recentlyTouched", () => {
  test("keeps only files touched inside the window", () => {
    expect([...recentlyTouched(NODES, 1000, 200).keys()].sort()).toEqual(["lib/disk.ts", "src/a.ts"]);
  });
});
