import { describe, expect, test } from "bun:test";

import { treeKeyAction } from "./tree-keys";

const closedDir = { isDir: true, isOpen: false };
const openDir = { isDir: true, isOpen: true };
const file = { isDir: false, isOpen: false };

describe("treeKeyAction", () => {
  test("up and down move focus on any row", () => {
    expect(treeKeyAction("ArrowDown", file)).toBe("next");
    expect(treeKeyAction("ArrowUp", openDir)).toBe("previous");
  });

  test("right opens a closed folder and left closes an open one", () => {
    expect(treeKeyAction("ArrowRight", closedDir)).toBe("toggle");
    expect(treeKeyAction("ArrowLeft", openDir)).toBe("toggle");
  });

  test("right on an open folder, left on a closed one, and any key on a file do nothing", () => {
    expect(treeKeyAction("ArrowRight", openDir)).toBeNull();
    expect(treeKeyAction("ArrowLeft", closedDir)).toBeNull();
    expect(treeKeyAction("ArrowRight", file)).toBeNull();
    expect(treeKeyAction("a", closedDir)).toBeNull();
  });
});
