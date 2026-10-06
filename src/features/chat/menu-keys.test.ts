import { describe, expect, test } from "bun:test";

import { columnAfterArrow, columnOfRole } from "./menu-keys";

describe("columnOfRole", () => {
  test("tells a model entry from an effort entry", () => {
    expect(columnOfRole("menuitem")).toBe("models");
    expect(columnOfRole("menuitemradio")).toBe("efforts");
  });

  test("ignores anything else in the menu", () => {
    expect(columnOfRole("menu")).toBeNull();
    expect(columnOfRole(null)).toBeNull();
  });
});

describe("columnAfterArrow", () => {
  test("Right goes from a model into its efforts, Left comes back", () => {
    expect(columnAfterArrow("ArrowRight", "models")).toBe("efforts");
    expect(columnAfterArrow("ArrowLeft", "efforts")).toBe("models");
  });

  test("the arrow that points away from the other column does nothing", () => {
    expect(columnAfterArrow("ArrowLeft", "models")).toBeNull();
    expect(columnAfterArrow("ArrowRight", "efforts")).toBeNull();
  });

  test("other keys are left to the browser", () => {
    expect(columnAfterArrow("Tab", "models")).toBeNull();
    expect(columnAfterArrow("ArrowDown", "efforts")).toBeNull();
  });
});
