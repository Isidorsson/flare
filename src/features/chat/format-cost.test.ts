import { describe, expect, test } from "bun:test";

import { formatCost } from "./format-cost";

describe("formatCost", () => {
  test("shows dollars and cents", () => {
    expect(formatCost(0.0912)).toBe("$0.09");
    expect(formatCost(12.5)).toBe("$12.50");
  });

  test("does not show a misleading zero for tiny costs", () => {
    expect(formatCost(0.002)).toBe("<$0.01");
  });
});
