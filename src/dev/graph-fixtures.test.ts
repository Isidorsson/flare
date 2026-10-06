import { describe, expect, test } from "bun:test";

import { graphSnapshotSchema } from "@/features/graph/graph-types";

import { agentScript, FIXTURE_NAMES, FIXTURE_SIZES, generateSnapshot, isFixtureSize } from "./graph-fixtures";

describe("generateSnapshot", () => {
  test("produces valid snapshots of roughly the requested size", () => {
    for (const name of FIXTURE_NAMES) {
      const snapshot = graphSnapshotSchema.parse(generateSnapshot(name));
      expect(Math.abs(snapshot.nodes.length - FIXTURE_SIZES[name])).toBeLessThan(FIXTURE_SIZES[name] * 0.2 + 3);
    }
  });

  test("is deterministic and uses unique file ids", () => {
    const first = generateSnapshot("medium");
    expect(generateSnapshot("medium")).toEqual(first);
    expect(new Set(first.nodes.map((node) => node.id)).size).toBe(first.nodes.length);
  });

  test("only links files that exist, never to themselves", () => {
    const snapshot = generateSnapshot("medium");
    const ids = new Set(snapshot.nodes.map((node) => node.id));
    for (const edge of snapshot.edges) {
      expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
      expect(edge.source).not.toBe(edge.target);
    }
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
