import { describe, expect, test } from "bun:test";

import { KEYBOARD_STEP, KEYBOARD_STEP_LARGE, sizeAfterDrag, sizeAfterKey } from "./splitter-math";

const BOUNDS = { min: 100, max: 400 };

describe("sizeAfterDrag", () => {
  test("grows a right-edge pane when dragged right", () => {
    expect(sizeAfterDrag("right", 200, 50, BOUNDS)).toBe(250);
  });

  test("grows a left-edge pane when dragged left", () => {
    expect(sizeAfterDrag("left", 200, -50, BOUNDS)).toBe(250);
  });

  test("grows a top-edge pane when dragged up", () => {
    expect(sizeAfterDrag("top", 200, -30, BOUNDS)).toBe(230);
  });

  test("clamps to the bounds", () => {
    expect(sizeAfterDrag("right", 200, 5000, BOUNDS)).toBe(BOUNDS.max);
    expect(sizeAfterDrag("right", 200, -5000, BOUNDS)).toBe(BOUNDS.min);
  });
});

describe("sizeAfterKey", () => {
  const press = (key: string, shiftKey = false) => ({ key, shiftKey });

  test("moves the separator in the arrow direction", () => {
    expect(sizeAfterKey("right", press("ArrowRight"), 200, BOUNDS)).toBe(200 + KEYBOARD_STEP);
    expect(sizeAfterKey("left", press("ArrowRight"), 200, BOUNDS)).toBe(200 - KEYBOARD_STEP);
    expect(sizeAfterKey("top", press("ArrowUp"), 200, BOUNDS)).toBe(200 + KEYBOARD_STEP);
  });

  test("uses a larger step with shift", () => {
    expect(sizeAfterKey("right", press("ArrowRight", true), 200, BOUNDS)).toBe(
      200 + KEYBOARD_STEP_LARGE,
    );
  });

  test("jumps to the bounds with Home and End", () => {
    expect(sizeAfterKey("right", press("Home"), 200, BOUNDS)).toBe(BOUNDS.min);
    expect(sizeAfterKey("right", press("End"), 200, BOUNDS)).toBe(BOUNDS.max);
  });

  test("ignores arrows on the wrong axis and unrelated keys", () => {
    expect(sizeAfterKey("right", press("ArrowUp"), 200, BOUNDS)).toBeNull();
    expect(sizeAfterKey("top", press("ArrowLeft"), 200, BOUNDS)).toBeNull();
    expect(sizeAfterKey("right", press("a"), 200, BOUNDS)).toBeNull();
  });

  test("clamps keyboard resizing to the bounds", () => {
    expect(sizeAfterKey("right", press("ArrowRight"), 395, BOUNDS)).toBe(BOUNDS.max);
  });
});
