import { describe, expect, test } from "bun:test";

import {
  circleTouchesRect,
  ObstacleGrid,
  placeLabels,
  rectFor,
  rectsOverlap,
  SIDES_FOR_FILES,
  SIDES_FOR_HUBS,
  type LabelRequest,
  type Rect,
} from "./label-place";

const VIEW = { width: 400, height: 300 };

function request(id: string, x: number, y: number, overrides: Partial<LabelRequest> = {}): LabelRequest {
  return { id, size: { width: 60, height: 16 }, anchor: { x, y }, radius: 4, sides: SIDES_FOR_FILES, required: false, ...overrides };
}

describe("geometry", () => {
  test("detects overlapping rectangles and ignores touching edges", () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });

  test("detects a circle poking into a rectangle", () => {
    const rect: Rect = { x: 10, y: 10, width: 20, height: 10 };
    expect(circleTouchesRect({ id: "n", x: 5, y: 15, radius: 6 }, rect)).toBe(true);
    expect(circleTouchesRect({ id: "n", x: 5, y: 15, radius: 4 }, rect)).toBe(false);
  });

  test("puts a label beside its node on each side", () => {
    const base = request("a", 100, 100);
    expect(rectFor(base, "right").x).toBeGreaterThan(104);
    expect(rectFor(base, "left").x + 60).toBeLessThan(96);
    expect(rectFor(base, "top").y + 16).toBeLessThan(96);
    expect(rectFor(base, "bottom").y).toBeGreaterThan(104);
  });
});

describe("ObstacleGrid", () => {
  const grid = new ObstacleGrid([
    { id: "a", x: 20, y: 20, radius: 4 },
    { id: "b", x: 200, y: 200, radius: 4 },
    { id: "big", x: 120, y: 120, radius: 70 },
  ]);

  test("counts only the obstacles under a rectangle", () => {
    expect(grid.countUnder({ x: 10, y: 10, width: 20, height: 20 }, "none")).toBe(1);
    expect(grid.countUnder({ x: 190, y: 190, width: 20, height: 20 }, "none")).toBe(1);
    expect(grid.countUnder({ x: 300, y: 10, width: 20, height: 20 }, "none")).toBe(0);
  });

  test("ignores the node being labelled and finds large nodes from any covered cell", () => {
    expect(grid.countUnder({ x: 10, y: 10, width: 20, height: 20 }, "a")).toBe(0);
    expect(grid.countUnder({ x: 150, y: 90, width: 10, height: 10 }, "none")).toBe(1);
  });
});

describe("placeLabels", () => {
  test("never lets two labels overlap", () => {
    const requests = Array.from({ length: 12 }, (_, index) => request(`n${index}`, 100 + index * 6, 120));
    const placed = placeLabels(requests, VIEW, []);
    for (const [index, first] of placed.entries()) {
      for (const second of placed.slice(index + 1)) {
        expect(rectsOverlap(first.rect, second.rect), `${first.id} vs ${second.id}`).toBe(false);
      }
    }
    expect(placed.length).toBeLessThan(requests.length);
  });

  test("gives the highest priority first claim on the space", () => {
    const placed = placeLabels([request("first", 100, 100), request("second", 100, 100)], VIEW, []);
    expect(placed[0]?.id).toBe("first");
    expect(placed[0]?.side).toBe("right");
    expect(placed[1]?.side).not.toBe("right");
  });

  test("drops an ordinary label that would cover many nodes but keeps a required one", () => {
    const crowd = Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, x: 110 + index * 8, y: 100, radius: 3 }));
    const ordinary = placeLabels([request("n", 100, 100, { sides: ["right"] })], VIEW, crowd);
    expect(ordinary).toHaveLength(0);
    const required = placeLabels([request("n", 100, 100, { sides: ["right"], required: true })], VIEW, crowd);
    expect(required).toHaveLength(1);
  });

  test("prefers a side that covers fewer nodes", () => {
    const blocker = [{ id: "x", x: 112, y: 100, radius: 3 }, { id: "y", x: 130, y: 100, radius: 3 }, { id: "z", x: 150, y: 100, radius: 3 }];
    const placed = placeLabels([request("n", 100, 100)], VIEW, blocker);
    expect(placed[0]?.side).toBe("left");
  });

  test("keeps ordinary labels inside the view and clamps required ones", () => {
    const edge = placeLabels([request("n", 396, 150, { sides: ["right"] })], VIEW, []);
    expect(edge).toHaveLength(0);
    const forced = placeLabels([request("n", 396, 150, { sides: ["right"], required: true })], VIEW, []);
    expect(forced[0] === undefined ? 0 : forced[0].rect.x + forced[0].rect.width).toBeLessThanOrEqual(VIEW.width);
  });

  test("tries the top first for hubs", () => {
    const placed = placeLabels([request("hub", 200, 150, { sides: SIDES_FOR_HUBS })], VIEW, []);
    expect(placed[0]?.side).toBe("top");
  });
});
