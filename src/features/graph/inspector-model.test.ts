import { describe, expect, test } from "bun:test";

import type { NodeActivity } from "./activity-state";
import { buildGraphIndex, graphIndexFor } from "./graph-index";
import { formatAgo, inspectFile, LIST_LIMIT } from "./inspector-model";
import type { GraphSnapshot } from "./graph-types";

const FILES = [
  "src/lib/cart.ts",
  "src/app/api/route.ts",
  "src/components/CartSummary.tsx",
  "src/components/Page.tsx",
  "tests/cart.test.ts",
  "src/lib/money.ts",
];

const SNAPSHOT: GraphSnapshot = {
  root: "C:/work/acme-shop",
  nodes: FILES.map((id) => ({ id, language: "typescript" })),
  edges: [
    { source: "src/app/api/route.ts", target: "src/lib/cart.ts" },
    { source: "src/components/CartSummary.tsx", target: "src/lib/cart.ts" },
    { source: "src/components/Page.tsx", target: "src/components/CartSummary.tsx" },
    { source: "tests/cart.test.ts", target: "src/lib/cart.ts" },
    { source: "src/lib/cart.ts", target: "src/lib/money.ts" },
  ],
  warnings: [],
};

const index = buildGraphIndex(SNAPSHOT);

function activity(overrides: Partial<NodeActivity>): NodeActivity {
  return { reads: 0, edits: 0, linesChanged: 0, lastKind: "read", lastTouchedAt: 0, changedTurn: null, ...overrides };
}

describe("formatAgo", () => {
  test("rounds down to the largest sensible unit", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(4999)).toBe("just now");
    expect(formatAgo(42_000)).toBe("42s ago");
    expect(formatAgo(5 * 60_000 + 10)).toBe("5m ago");
    expect(formatAgo(3 * 3_600_000)).toBe("3h ago");
  });
});

describe("inspectFile", () => {
  const context = { activity: undefined, turn: 1, now: 10_000 };

  test("describes a file's place in the code", () => {
    const model = inspectFile(index, "src/lib/cart.ts", context);
    expect(model).toMatchObject({ name: "cart.ts", folder: "src/lib", role: "code", importerCount: 3, importCount: 1 });
    expect(model?.importers.map((ref) => ref.name).sort()).toEqual(["CartSummary.tsx", "cart.test.ts", "route.ts"]);
  });

  test("counts everything a change can reach and the tests among it", () => {
    const model = inspectFile(index, "src/lib/cart.ts", context);
    expect(model?.affected).toBe(4);
    expect(model?.tests).toBe(1);
  });

  test("summarises the agent's activity and flags a change this turn", () => {
    const touched = activity({ reads: 1, edits: 2, linesChanged: 9, lastKind: "edit", lastTouchedAt: 9000, changedTurn: 3 });
    const model = inspectFile(index, "src/lib/cart.ts", { activity: touched, turn: 3, now: 10_000 });
    expect(model?.changedThisTurn).toBe(true);
    expect(model?.activity).toEqual({ edits: 2, reads: 1, linesChanged: 9, lastKind: "edit", ago: "just now" });
    expect(inspectFile(index, "src/lib/cart.ts", { activity: touched, turn: 4, now: 10_000 })?.changedThisTurn).toBe(false);
  });

  test("reports no activity for a file only touched by the disk watcher", () => {
    expect(inspectFile(index, "src/lib/cart.ts", { ...context, activity: activity({ lastTouchedAt: 5 }) })?.activity).toBeNull();
  });

  test("returns null for a file that is not in the graph", () => {
    expect(inspectFile(index, "missing.ts", context)).toBeNull();
  });

  test("caps long lists but keeps the true count", () => {
    const many = Array.from({ length: LIST_LIMIT + 5 }, (_, position) => `src/users/u${position}.ts`);
    const wide: GraphSnapshot = {
      root: "C:/x",
      nodes: [...many, "src/core.ts"].map((id) => ({ id, language: "typescript" })),
      edges: many.map((source) => ({ source, target: "src/core.ts" })),
      warnings: [],
    };
    const model = inspectFile(buildGraphIndex(wide), "src/core.ts", context);
    expect(model?.importers).toHaveLength(LIST_LIMIT);
    expect(model?.importerCount).toBe(LIST_LIMIT + 5);
  });
});

describe("graphIndexFor", () => {
  test("builds an index once per snapshot", () => {
    expect(graphIndexFor(SNAPSHOT)).toBe(graphIndexFor(SNAPSHOT));
  });
});
