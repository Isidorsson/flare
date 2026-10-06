import { describe, expect, test } from "bun:test";

import { buildDirectoryTree } from "./directory-tree";
import { packCircles, packDirectories } from "./folder-pack";

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("packCircles", () => {
  test("keeps the first circle at the origin and never overlaps", () => {
    const radii = [5, 4, 4, 3, 3, 2, 2, 2, 1];
    const spots = packCircles(radii);
    expect(spots[0]).toEqual({ x: 0, y: 0 });
    for (let first = 0; first < radii.length; first += 1) {
      for (let second = first + 1; second < radii.length; second += 1) {
        const a = spots[first];
        const b = spots[second];
        if (a === undefined || b === undefined) throw new Error("missing spot");
        expect(distance(a, b)).toBeGreaterThanOrEqual((radii[first] ?? 0) + (radii[second] ?? 0) - 1e-6);
      }
    }
  });

  test("is deterministic and handles tiny inputs", () => {
    expect(packCircles([2, 1, 1])).toEqual(packCircles([2, 1, 1]));
    expect(packCircles([])).toEqual([]);
    expect(packCircles([3])).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("packDirectories", () => {
  const files = [
    "app/a.ts",
    "app/b.ts",
    "app/c.ts",
    "lib/a.ts",
    "lib/b.ts",
    "lib/deep/x.ts",
    "lib/deep/y.ts",
    "root.ts",
  ];
  const seeds = packDirectories(buildDirectoryTree(files));

  test("seeds every file and every folder exactly once", () => {
    expect([...seeds.files.keys()].sort()).toEqual([...files].sort());
    expect([...seeds.folders.keys()].sort()).toEqual(["", "app", "lib", "lib/deep"]);
  });

  test("places files near their own folder hub and apart from other folders", () => {
    const app = seeds.folders.get("app");
    const lib = seeds.folders.get("lib");
    const first = seeds.files.get("app/a.ts");
    if (app === undefined || lib === undefined || first === undefined) throw new Error("missing seed");
    expect(distance(first, app)).toBeLessThan(distance(first, lib));
    expect(distance(app, lib)).toBeGreaterThan(distance(first, app));
  });

  test("is stable for identical input", () => {
    const again = packDirectories(buildDirectoryTree([...files].reverse()));
    expect(again.files.get("lib/deep/x.ts")).toEqual(seeds.files.get("lib/deep/x.ts"));
  });

  test("scales with the requested spacing", () => {
    const wide = packDirectories(buildDirectoryTree(files), new Map(), 40);
    const near = seeds.folders.get("lib");
    const far = wide.folders.get("lib");
    if (near === undefined || far === undefined) throw new Error("missing seed");
    expect(distance(far, { x: 0, y: 0 })).toBeGreaterThan(distance(near, { x: 0, y: 0 }));
  });
});
