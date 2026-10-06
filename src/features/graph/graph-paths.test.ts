import { describe, expect, test } from "bun:test";

import {
  baseName,
  createNodeResolver,
  hashString,
  toAbsolutePath,
  toGraphPath,
} from "./graph-paths";

describe("toGraphPath", () => {
  test("strips the workspace root from absolute Windows paths", () => {
    expect(toGraphPath("C:\\Users\\me\\app", "C:\\Users\\me\\app\\src\\a.ts")).toBe("src/a.ts");
    expect(toGraphPath("C:/Users/me/app/", "C:/Users/me/app/src/a.ts")).toBe("src/a.ts");
  });

  test("strips the workspace root from POSIX paths", () => {
    expect(toGraphPath("/home/me/app", "/home/me/app/src/a.ts")).toBe("src/a.ts");
  });

  test("compares the root case-insensitively", () => {
    expect(toGraphPath("C:/Users/Me/App", "c:/users/me/app/src/a.ts")).toBe("src/a.ts");
  });

  test("handles verbatim prefixes", () => {
    expect(toGraphPath("C:/app", "\\\\?\\C:\\app\\src\\a.ts")).toBe("src/a.ts");
  });

  test("returns relative paths cleaned", () => {
    expect(toGraphPath("C:/app", "./src/../src/a.ts")).toBe("src/a.ts");
    expect(toGraphPath("C:/app", "src\\a.ts")).toBe("src/a.ts");
  });

  test("rejects paths outside the root", () => {
    expect(toGraphPath("C:/app", "C:/other/a.ts")).toBeNull();
    expect(toGraphPath("C:/app", "C:/application/a.ts")).toBeNull();
    expect(toGraphPath("C:/app", "../escape.ts")).toBeNull();
  });

  test("maps the root itself to the empty path", () => {
    expect(toGraphPath("C:/app", "C:/app")).toBe("");
  });
});

describe("path helpers", () => {
  test("toAbsolutePath joins the root and the id with forward slashes", () => {
    expect(toAbsolutePath("C:\\app\\", "src/a.ts")).toBe("C:/app/src/a.ts");
  });

  test("baseName", () => {
    expect(baseName("src/features/chat/ChatPane.tsx")).toBe("ChatPane.tsx");
    expect(baseName("main.rs")).toBe("main.rs");
  });

  test("hashString is deterministic, unsigned and spreads inputs", () => {
    expect(hashString("src/a.ts")).toBe(hashString("src/a.ts"));
    expect(hashString("src/a.ts")).not.toBe(hashString("src/b.ts"));
    expect(hashString("anything")).toBeGreaterThanOrEqual(0);
    expect(hashString("anything")).toBeLessThan(2 ** 32);
  });
});

describe("createNodeResolver", () => {
  const resolver = createNodeResolver(["src/App.tsx", "src/util.ts"]);

  test("resolves exact ids", () => {
    expect(resolver.resolve("src/App.tsx")).toBe("src/App.tsx");
  });

  test("falls back to a case-insensitive match and returns the indexed spelling", () => {
    expect(resolver.resolve("SRC/app.tsx")).toBe("src/App.tsx");
  });

  test("returns null for unknown paths", () => {
    expect(resolver.resolve("src/missing.ts")).toBeNull();
  });
});
