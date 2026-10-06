import { describe, expect, test } from "bun:test";

import { CLOSED, TOOLTIP_DELAY_MS, isOpen, timerAction, transition, type TooltipEvent } from "./tooltip-machine";

function run(...events: TooltipEvent[]) {
  return events.reduce(transition, CLOSED);
}

describe("tooltip visibility", () => {
  test("is closed until something happens", () => {
    expect(isOpen(CLOSED)).toBe(false);
  });

  test("hover alone does not open it before the delay", () => {
    expect(isOpen(run("pointerenter"))).toBe(false);
  });

  test("hover opens it once the delay elapses", () => {
    expect(isOpen(run("pointerenter", "delay"))).toBe(true);
  });

  test("leaving closes it and the next hover waits again", () => {
    const left = run("pointerenter", "delay", "pointerleave");
    expect(isOpen(left)).toBe(false);
    expect(isOpen(transition(left, "pointerenter"))).toBe(false);
  });

  test("a delay that fires after the pointer left is ignored", () => {
    expect(isOpen(run("pointerenter", "pointerleave", "delay"))).toBe(false);
  });

  test("keyboard focus opens it immediately and blur closes it", () => {
    const focused = run("focus");
    expect(isOpen(focused)).toBe(true);
    expect(isOpen(transition(focused, "blur"))).toBe(false);
  });

  test("stays open on focus when the pointer leaves", () => {
    expect(isOpen(run("focus", "pointerenter", "delay", "pointerleave"))).toBe(true);
  });

  test("Escape closes it for hover and for focus", () => {
    expect(isOpen(run("pointerenter", "delay", "escape"))).toBe(false);
    expect(isOpen(run("focus", "escape"))).toBe(false);
  });

  test("Escape holds through later delays and clears when the pointer or focus comes back", () => {
    expect(isOpen(run("pointerenter", "delay", "escape", "delay"))).toBe(false);
    expect(isOpen(run("pointerenter", "delay", "escape", "pointerleave", "pointerenter", "delay"))).toBe(true);
    expect(isOpen(run("focus", "escape", "blur", "focus"))).toBe(true);
  });

  test("pressing hides it, and the focus a click causes does not bring it back", () => {
    const clicked = run("pointerenter", "delay", "press", "focus");
    expect(isOpen(clicked)).toBe(false);
  });

  test("keyboard focus after the pointer has left opens it again", () => {
    const state = run("pointerenter", "press", "pointerleave", "focus");
    expect(isOpen(state)).toBe(true);
  });
});

describe("hover timer", () => {
  test("starts on enter", () => {
    expect(timerAction("pointerenter")).toBe("start");
  });

  test("is cancelled by leave, press and Escape", () => {
    expect(timerAction("pointerleave")).toBe("cancel");
    expect(timerAction("press")).toBe("cancel");
    expect(timerAction("escape")).toBe("cancel");
  });

  test("is left alone by focus changes and its own firing", () => {
    expect(timerAction("focus")).toBe("keep");
    expect(timerAction("blur")).toBe("keep");
    expect(timerAction("delay")).toBe("keep");
  });

  test("waits long enough to skip a pass-through but not so long it feels broken", () => {
    expect(TOOLTIP_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(TOOLTIP_DELAY_MS).toBeLessThanOrEqual(500);
  });
});
