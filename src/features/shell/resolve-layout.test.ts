import { describe, expect, test } from "bun:test";

import {
  CENTER_MIN_WIDTH,
  CHAT_MIN_HEIGHT,
  PANE_LIMITS,
  TERMINAL_HEADER_HEIGHT,
} from "./layout-constants";
import { resolveLayout } from "./resolve-layout";

const STORED = { sidebarWidth: 280, rightWidth: 420, terminalHeight: 260 };

describe("resolveLayout", () => {
  test("keeps stored sizes when the viewport is roomy", () => {
    const layout = resolveLayout(STORED, { width: 1920, height: 1080 });

    expect(layout.sidebar).toBe(280);
    expect(layout.right).toBe(420);
    expect(layout.terminal).toBe(260);
  });

  test("shrinks the right pane first when the centre would get too narrow", () => {
    const width = CENTER_MIN_WIDTH + 280 + 350;
    const layout = resolveLayout(STORED, { width, height: 900 });

    expect(layout.sidebar).toBe(280);
    expect(layout.right).toBe(350);
  });

  test("then shrinks the sidebar once the right pane reaches its minimum", () => {
    const width = CENTER_MIN_WIDTH + 240 + PANE_LIMITS.right.min;
    const layout = resolveLayout(STORED, { width, height: 900 });

    expect(layout.right).toBe(PANE_LIMITS.right.min);
    expect(layout.sidebar).toBe(240);
  });

  test("never goes below the pane minimums, even in a tiny window", () => {
    const layout = resolveLayout(STORED, { width: 500, height: 900 });

    expect(layout.sidebar).toBe(PANE_LIMITS.sidebar.min);
    expect(layout.right).toBe(PANE_LIMITS.right.min);
  });

  test("limits the sidebar bound by the width the right pane leaves free", () => {
    const width = CENTER_MIN_WIDTH + 600;
    const layout = resolveLayout(STORED, { width, height: 900 });

    expect(layout.bounds.sidebar.max).toBe(width - CENTER_MIN_WIDTH - layout.right);
    expect(layout.bounds.right.max).toBe(width - CENTER_MIN_WIDTH - layout.sidebar);
  });

  test("keeps the chat tall enough by capping the terminal height", () => {
    const height = CHAT_MIN_HEIGHT + TERMINAL_HEADER_HEIGHT + 150;
    const layout = resolveLayout(STORED, { width: 1600, height });

    expect(layout.terminal).toBe(150);
    expect(layout.bounds.terminal).toEqual({ min: PANE_LIMITS.terminal.min, max: 150 });
  });

  test("falls back to the terminal minimum when there is no room at all", () => {
    const layout = resolveLayout(STORED, { width: 1600, height: 100 });

    expect(layout.terminal).toBe(PANE_LIMITS.terminal.min);
    expect(layout.bounds.terminal.max).toBe(PANE_LIMITS.terminal.min);
  });
});
