import { describe, expect, test } from "bun:test";

import {
  buildDirectoryTree,
  collectFiles,
  fileFolder,
  folderId,
  folderName,
  folderPath,
  isFolderId,
  owningHub,
  parentFolder,
  selectHubFolders,
} from "./directory-tree";

const FILES = [
  "README.ts",
  "src/app/main.ts",
  "src/app/api/route.ts",
  "src/lib/cart.ts",
  "src/lib/money.ts",
  "tests/cart.test.ts",
];

describe("folder ids", () => {
  test("round-trip a folder path and never collide with a file", () => {
    expect(folderPath(folderId("src/lib"))).toBe("src/lib");
    expect(isFolderId(folderId(""))).toBe(true);
    expect(isFolderId("src/lib/cart.ts")).toBe(false);
    expect(() => folderPath("src/lib/cart.ts")).toThrow("not a folder id");
  });

  test("walks up the hierarchy", () => {
    expect(fileFolder("src/lib/cart.ts")).toBe("src/lib");
    expect(fileFolder("README.ts")).toBe("");
    expect(parentFolder("src/lib")).toBe("src");
    expect(parentFolder("src")).toBe("");
    expect(parentFolder("")).toBeNull();
    expect(folderName("src/lib")).toBe("lib");
  });
});

describe("buildDirectoryTree", () => {
  const tree = buildDirectoryTree(FILES);

  test("counts files recursively", () => {
    expect(tree.size).toBe(6);
    expect(tree.files).toEqual(["README.ts"]);
    expect(tree.dirs.map((dir) => [dir.path, dir.size])).toEqual([
      ["src", 4],
      ["tests", 1],
    ]);
  });

  test("keeps nested folders sorted and named", () => {
    const src = tree.dirs[0];
    expect(src?.dirs.map((dir) => dir.name)).toEqual(["app", "lib"]);
    expect(src?.dirs[0]?.dirs[0]?.path).toBe("src/app/api");
  });

  test("collects every file below a folder", () => {
    expect(collectFiles(tree).sort()).toEqual([...FILES].sort());
  });

  test("handles an empty project", () => {
    expect(buildDirectoryTree([]).size).toBe(0);
  });
});

describe("selectHubFolders", () => {
  const tree = buildDirectoryTree(FILES);

  test("keeps every folder when they all fit", () => {
    expect([...selectHubFolders(tree)].sort()).toEqual(["", "src", "src/app", "src/app/api", "src/lib", "tests"]);
  });

  test("drops the smallest folders first when over the cap", () => {
    const hubs = selectHubFolders(tree, 3);
    expect(hubs.has("")).toBe(true);
    expect(hubs.has("src")).toBe(true);
    expect(hubs.has("src/app/api")).toBe(false);
    expect(hubs.size).toBeLessThanOrEqual(4);
  });

  test("always includes the ancestors of a hub", () => {
    const wide = buildDirectoryTree(Array.from({ length: 30 }, (_, index) => `a/b/c${index % 6}/f${index}.ts`));
    for (const hub of selectHubFolders(wide, 3)) {
      let current = parentFolder(hub);
      while (current !== null) {
        expect(selectHubFolders(wide, 3).has(current)).toBe(true);
        current = parentFolder(current);
      }
    }
  });

  test("resolves the owning hub of a collapsed folder", () => {
    const hubs = new Set(["", "src"]);
    expect(owningHub(hubs, "src/lib/deep")).toBe("src");
    expect(owningHub(hubs, "tests")).toBe("");
  });
});
