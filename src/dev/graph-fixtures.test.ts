import { describe, expect, test } from "bun:test";

import { graphSnapshotSchema } from "@/features/graph/graph-types";

import { agentScript, FIXTURE_NAMES, FIXTURE_SIZES, GENERATED_NAMES, generateSnapshot, isFixtureSize } from "./graph-fixtures";
import { LUA_FOCUS_FILE } from "./lua-fixture";

describe("generateSnapshot", () => {
  test("produces valid snapshots of roughly the requested size", () => {
    for (const name of GENERATED_NAMES) {
      const snapshot = graphSnapshotSchema.parse(generateSnapshot(name));
      expect(Math.abs(snapshot.nodes.length - FIXTURE_SIZES[name])).toBeLessThan(FIXTURE_SIZES[name] * 0.2 + 3);
    }
  });

  test("is deterministic and uses unique file ids", () => {
    const first = generateSnapshot("medium");
    expect(generateSnapshot("medium")).toEqual(first);
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length);
  });

  test("only links files that exist, never to themselves, once per direction", () => {
    for (const name of FIXTURE_NAMES) {
      const snapshot = graphSnapshotSchema.parse(generateSnapshot(name));
      const ids = new Set(snapshot.nodes.map((node) => node.id));
      const keys = snapshot.edges.map((edge) => `${edge.source}>${edge.target}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const edge of snapshot.edges) {
        expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
        expect(edge.source).not.toBe(edge.target);
      }
    }
  });

  test("the lua project has a big root hub and a focus file with importers, imports and mutual requires", () => {
    const snapshot = generateSnapshot("lua");
    const rootFiles = snapshot.nodes.filter((node) => !node.id.includes("/"));
    expect(rootFiles.length).toBeGreaterThan(20);
    const into = snapshot.edges.filter((edge) => edge.target === LUA_FOCUS_FILE).map((edge) => edge.source);
    const out = snapshot.edges.filter((edge) => edge.source === LUA_FOCUS_FILE).map((edge) => edge.target);
    expect(into.length).toBeGreaterThan(5);
    expect(out.filter((target) => into.includes(target))).toHaveLength(2);
    expect(out.length).toBeGreaterThan(3);
  });

  test("spreads files over several folders and languages", () => {
    const snapshot = generateSnapshot("large");
    const folders = new Set(snapshot.nodes.map((node) => node.id.slice(0, node.id.lastIndexOf("/"))));
    expect(folders.size).toBeGreaterThan(30);
    expect(new Set(snapshot.nodes.map((node) => node.language)).size).toBeGreaterThan(2);
  });
});

describe("agentScript", () => {
  test("walks existing files and ends by changing something", () => {
    const snapshot = generateSnapshot("small");
    const ids = new Set(snapshot.nodes.map((node) => node.id));
    const steps = agentScript(snapshot);
    for (const step of steps) {
      if (step.path !== undefined) expect(ids.has(step.path)).toBe(true);
    }
    expect(steps.at(-1)?.kind).toBe("edit");
    expect(steps.some((step) => step.kind === "create")).toBe(true);
  });

  test("recognises fixture names", () => {
    expect(isFixtureSize("large")).toBe(true);
    expect(isFixtureSize("huge")).toBe(false);
    expect(isFixtureSize(null)).toBe(false);
  });
});
