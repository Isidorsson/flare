import { describe, expect, test } from "bun:test";

import {
  baseName,
  isAbsolutePath,
  isInside,
  normalizePath,
  parentDir,
  relativeTo,
  resolvePath,
} from "./paths";

describe("normalizePath", () => {
  test("uses forward slashes and upper-cases the drive letter", () => {
    expect(normalizePath("c:\\Users\\me\\proj\\src\\a.ts")).toBe("C:/Users/me/proj/src/a.ts");
  });

  test("collapses dot segments, duplicate slashes and trailing slashes", () => {
    expect(normalizePath("C:/a//b/./c/../d/")).toBe("C:/a/b/d");
  });

  test("keeps drive and posix roots", () => {
    expect(normalizePath("C:\\")).toBe("C:/");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/home/me/")).toBe("/home/me");
  });

  test("never climbs above the root", () => {
    expect(normalizePath("C:/a/../../b")).toBe("C:/b");
  });

  test("keeps UNC prefixes", () => {
    expect(normalizePath("\\\\server\\share\\x")).toBe("//server/share/x");
  });
});

describe("isAbsolutePath", () => {
  test("recognises drive, posix and UNC paths", () => {
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("c:/x")).toBe(true);
    expect(isAbsolutePath("/x")).toBe(true);
    expect(isAbsolutePath("\\\\server\\x")).toBe(true);
    expect(isAbsolutePath("src/a.ts")).toBe(false);
    expect(isAbsolutePath("C:foo")).toBe(false);
  });
});

describe("resolvePath", () => {
  test("normalizes absolute paths without needing a root", () => {
    expect(resolvePath(null, "c:\\p\\a.ts")).toBe("C:/p/a.ts");
  });

  test("joins relative paths onto the root", () => {
    expect(resolvePath("C:/p", "src\\a.ts")).toBe("C:/p/src/a.ts");
    expect(resolvePath("C:/p", "./src/../a.ts")).toBe("C:/p/a.ts");
  });

  test("returns null for a relative path with no root", () => {
    expect(resolvePath(null, "src/a.ts")).toBeNull();
  });
});

describe("isInside and relativeTo", () => {
  test("detects containment on whole segments only", () => {
    expect(isInside("C:/p", "C:/p/src/a.ts")).toBe(true);
    expect(isInside("C:/p", "C:/p")).toBe(true);
    expect(isInside("C:/p", "C:/p-evil/a.ts")).toBe(false);
    expect(isInside("C:/", "C:/x")).toBe(true);
  });

  test("builds workspace-relative paths", () => {
    expect(relativeTo("C:/p", "C:\\p\\src\\a.ts")).toBe("src/a.ts");
    expect(relativeTo("C:/p", "C:/p")).toBe("");
    expect(relativeTo("C:/p", "D:/other/a.ts")).toBe("D:/other/a.ts");
  });
});

describe("parentDir and baseName", () => {
  test("walks up one directory", () => {
    expect(parentDir("C:/p/src/a.ts")).toBe("C:/p/src");
    expect(parentDir("C:/p")).toBe("C:/");
    expect(parentDir("C:/")).toBeNull();
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("/")).toBeNull();
    expect(parentDir("a.ts")).toBeNull();
  });

  test("returns the final segment", () => {
    expect(baseName("C:/p/src/a.ts")).toBe("a.ts");
    expect(baseName("C:/p/src/")).toBe("src");
  });
});
