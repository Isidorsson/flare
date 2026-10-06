import { describe, expect, test } from "bun:test";

import { baseName } from "./path-name";

describe("baseName", () => {
  test("handles Windows and POSIX separators", () => {
    expect(baseName("C:\\Users\\me\\project")).toBe("project");
    expect(baseName("/home/me/project")).toBe("project");
    expect(baseName("C:/work/app/src/a.ts")).toBe("a.ts");
  });

  test("ignores trailing separators", () => {
    expect(baseName("C:\\Users\\me\\project\\")).toBe("project");
    expect(baseName("/home/me/project//")).toBe("project");
  });

  test("falls back to the whole path for roots and bare names", () => {
    expect(baseName("project")).toBe("project");
    expect(baseName("C:")).toBe("C:");
    expect(baseName("/")).toBe("/");
  });
});
