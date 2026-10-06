import { describe, expect, test } from "bun:test";

import { buildGraphIndex, hubOfFile } from "./graph-index";
import type { GraphSnapshot } from "./graph-types";

function snapshot(files: readonly string[], edges: readonly (readonly [string, string])[] = []): GraphSnapshot {
  return {
    root: "C:\\work\\acme-shop\\",
    nodes: files.map((id) => ({ id, language: "typescript" })),
    edges: edges.map(([source, target]) => ({ source, target })),
    warnings: [],
  };
}

const FILES = [
  "src/components/Cart.tsx",
  "src/components/Page.tsx",
  "src/lib/cart.ts",
  "src/lib/money.ts",
  "tests/cart.test.ts",
  "main.ts",
];

describe("buildGraphIndex", () => {
  const index = buildGraphIndex(
    snapshot(FILES, [
      ["src/components/Cart.tsx", "src/lib/cart.ts"],
      ["src/components/Page.tsx", "src/lib/cart.ts"],
      ["src/lib/cart.ts", "src/lib/money.ts"],
      ["tests/cart.test.ts", "src/lib/cart.ts"],
    ]),
  );

  test("names the project root after its folder", () => {
    expect(index.rootLabel).toBe("acme-shop");
    expect(index.hubNames.get("")).toBe("acme-shop");
  });

  test("gives every file a role and counts roles", () => {
    expect(index.roles.get("src/components/Cart.tsx")).toBe("frontend");
    expect(index.roles.get("tests/cart.test.ts")).toBe("tests");
    expect(index.roleCounts.frontend).toBe(2);
    expect(index.roleCounts.tests).toBe(1);
  });

  test("tints a folder by the role most of its files have", () => {
    expect(index.folderRoles.get("src/components")).toBe("frontend");
    expect(index.folderRoles.get("tests")).toBe("tests");
  });

  test("ranks files by who leans on them", () => {
    const imports = index.importance;
    expect(imports.get("src/lib/cart.ts") ?? 0).toBeGreaterThan(imports.get("src/lib/money.ts") ?? 0);
    expect(imports.get("main.ts")).toBe(0);
  });

  test("lists importers and imports of each file", () => {
    expect([...(index.importers.get("src/lib/cart.ts") ?? [])].sort()).toEqual([
      "src/components/Cart.tsx",
      "src/components/Page.tsx",
      "tests/cart.test.ts",
    ]);
    expect(index.imports.get("src/lib/cart.ts")).toEqual(["src/lib/money.ts"]);
  });

  test("ignores self-imports in the adjacency", () => {
    const self = buildGraphIndex(snapshot(["a.ts"], [["a.ts", "a.ts"]]));
    expect(self.importers.get("a.ts")).toBeUndefined();
  });
});

describe("hubs", () => {
  test("assigns a file to the nearest hub above it", () => {
    const index = buildGraphIndex(snapshot(FILES));
    expect(hubOfFile(index, "src/lib/cart.ts")).toBe("src/lib");
    expect(hubOfFile(index, "main.ts")).toBe("");
  });

  test("collapses small folders into their parent when there are too many hubs", () => {
    const many = Array.from({ length: 60 }, (_, folder) => `pkg/f${folder}/a.ts`);
    const index = buildGraphIndex(snapshot([...many, ...many.map((file) => file.replace("a.ts", "b.ts"))]));
    expect(index.hubs.size).toBeLessThan(40);
    expect(hubOfFile(index, "pkg/f59/a.ts")).toMatch(/^(pkg|pkg\/f59)$/);
  });

  test("adds a parent name where two hubs would read the same", () => {
    const index = buildGraphIndex(
      snapshot(["a/components/x.ts", "a/components/y.ts", "b/components/x.ts", "b/components/y.ts", "c/solo.ts"]),
    );
    expect(index.hubNames.get("a/components")).toBe("a/components");
    expect(index.hubNames.get("b/components")).toBe("b/components");
    expect(index.hubNames.get("c")).toBe("c");
  });
});
