import { describe, expect, test } from "bun:test";

import {
  blastRadiusSchema,
  changeSchema,
  graphSnapshotSchema,
  LANGUAGES,
  type GraphSnapshot,
} from "./graph-types";

const rustJson: GraphSnapshot = {
  root: "C:/Users/me/app",
  nodes: [
    { id: "src/lib.rs", language: "rust" },
    { id: "web/a.tsx", language: "typescript" },
  ],
  edges: [{ source: "src/lib.rs", target: "src/util.rs" }],
  warnings: ["tsconfig.json: invalid JSON (expected value)"],
};

describe("graph snapshot schema", () => {
  test("accepts the shape the Rust command serialises", () => {
    expect(graphSnapshotSchema.parse(rustJson)).toEqual(rustJson);
  });

  test("accepts an empty graph", () => {
    const empty = { root: "C:/app", nodes: [], edges: [], warnings: [] };
    expect(graphSnapshotSchema.parse(empty)).toEqual(empty);
  });

  test("rejects unknown languages", () => {
    const bad = { ...rustJson, nodes: [{ id: "a.cob", language: "cobol" }] };
    expect(graphSnapshotSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects empty node ids and missing fields", () => {
    expect(graphSnapshotSchema.safeParse({ ...rustJson, nodes: [{ id: "", language: "rust" }] }).success).toBe(false);
    expect(graphSnapshotSchema.safeParse({ root: "x", nodes: [], edges: [] }).success).toBe(false);
  });

  test("lists every language the Rust side can emit", () => {
    expect([...LANGUAGES].sort()).toEqual([
      "c",
      "cpp",
      "csharp",
      "css",
      "dart",
      "go",
      "java",
      "javascript",
      "kotlin",
      "lua",
      "luau",
      "php",
      "python",
      "ruby",
      "rust",
      "shell",
      "svelte",
      "swift",
      "typescript",
      "vue",
      "zig",
    ]);
  });

  test("accepts a node of every language", () => {
    const nodes = LANGUAGES.map((language) => ({ id: `src/file.${language}`, language }));
    const snapshot = { root: "C:/app", nodes, edges: [], warnings: [] };
    expect(graphSnapshotSchema.parse(snapshot).nodes.map((node) => node.language)).toEqual([...LANGUAGES]);
  });
});

describe("blast radius schema", () => {
  test("accepts dependents with positive depths", () => {
    const radius = { origin: "src/a.ts", nodes: [{ id: "src/b.ts", depth: 1 }] };
    expect(blastRadiusSchema.parse(radius)).toEqual(radius);
  });

  test("rejects zero, negative and fractional depths", () => {
    for (const depth of [0, -1, 1.5]) {
      const radius = { origin: "src/a.ts", nodes: [{ id: "src/b.ts", depth }] };
      expect(blastRadiusSchema.safeParse(radius).success).toBe(false);
    }
  });
});

describe("change schema", () => {
  test("accepts exactly the Rust change kinds", () => {
    for (const change of ["unchanged", "added", "updated", "removed", "rebuilt"] as const) {
      expect(changeSchema.parse(change)).toBe(change);
    }
    expect(changeSchema.safeParse("moved").success).toBe(false);
  });
});
