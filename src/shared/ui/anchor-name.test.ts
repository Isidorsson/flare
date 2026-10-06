import { describe, expect, test } from "bun:test";

import { addAnchorName, anchorNameFor } from "./anchor-name";

describe("addAnchorName", () => {
  test("uses the name alone when the element has none", () => {
    expect(addAnchorName(undefined, "--tip-r1")).toBe("--tip-r1");
    expect(addAnchorName("none", "--tip-r1")).toBe("--tip-r1");
  });

  test("keeps the names the element already has", () => {
    expect(addAnchorName("--model-menu-r2", "--tip-r1")).toBe("--model-menu-r2, --tip-r1");
  });
});

describe("anchorNameFor", () => {
  test("strips the characters React ids use", () => {
    expect(anchorNameFor("tip", ":r1a:")).toBe("--tip-r1a");
    expect(anchorNameFor("tip", "«r2»")).toBe("--tip-r2");
    expect(anchorNameFor("tip", "_r_3_")).toBe("--tip-_r_3_");
  });

  test("keeps different ids apart", () => {
    expect(anchorNameFor("tip", ":r1:")).not.toBe(anchorNameFor("tip", ":r2:"));
  });
});
