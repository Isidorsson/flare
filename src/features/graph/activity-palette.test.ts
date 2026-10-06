import { describe, expect, test } from "bun:test";

import { ACTIVITY_TOKENS, activityColor, readActivityPalette } from "./activity-palette";
import { ACTIVITY_KINDS } from "./activity-types";
import { fixtureActivityPalette, readTokenFromCss } from "./palette-fixture";

describe("activity palette", () => {
  test("every token is defined in tokens.css", () => {
    for (const token of Object.values(ACTIVITY_TOKENS)) {
      expect(readTokenFromCss(token).trim(), token).not.toBe("");
    }
  });

  test("uses the agreed colours", () => {
    const palette = fixtureActivityPalette();
    expect(palette.read.toLowerCase()).toBe("#78dceb");
    expect(palette.edit.toLowerCase()).toBe("#ff9f4a");
    expect(palette.create.toLowerCase()).toBe("#7fd99a");
    expect(palette.finish.toLowerCase()).toBe("#deb86e");
    expect(palette.agent.toLowerCase()).toBe("#d97757");
  });

  test("gives every kind of activity a colour, with reads, edits and creates distinct", () => {
    const palette = fixtureActivityPalette();
    for (const kind of ACTIVITY_KINDS) expect(activityColor(palette, kind)).toMatch(/^#[0-9a-f]{6}$/i);
    const distinct = new Set([activityColor(palette, "read"), activityColor(palette, "edit"), activityColor(palette, "create")]);
    expect(distinct.size).toBe(3);
    expect(activityColor(palette, "search")).toBe(palette.read);
  });

  test("fails fast on a missing or non-hex token", () => {
    expect(() => readActivityPalette(() => "")).toThrow("is not defined");
    expect(() => readActivityPalette(() => "rebeccapurple")).toThrow();
  });
});
