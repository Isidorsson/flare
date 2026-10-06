import { describe, expect, test } from "bun:test";

import { activityBadge, hubLabel, hubLabelText, truncateLabel } from "./label-text";

describe("truncateLabel", () => {
  test("leaves short names alone", () => {
    expect(truncateLabel("cart.ts")).toBe("cart.ts");
    expect(truncateLabel("a".repeat(24))).toBe("a".repeat(24));
  });

  test("keeps the extension and the ends of a long stem", () => {
    const result = truncateLabel("very-long-component-name-for-the-cart.tsx");
    expect(result.endsWith(".tsx")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(24);
    expect(result).toContain("…");
    expect(result.startsWith("very-long")).toBe(true);
  });

  test("handles names without an extension and tiny limits", () => {
    expect(truncateLabel("an-extremely-long-directory-name", 12).length).toBeLessThanOrEqual(12);
    expect(truncateLabel("abcdef", 3).length).toBeLessThanOrEqual(4);
  });

  test("does not treat a dotfile as an extension", () => {
    expect(truncateLabel(".averyveryverylongdotfilename", 12)).toStartWith(".averyv");
  });
});

describe("hub labels", () => {
  test("shows a folder name with its slash and file count", () => {
    expect(hubLabelText(hubLabel("src", 15, false))).toBe("src/ 15");
  });

  test("shows the project root by name only", () => {
    expect(hubLabelText(hubLabel("acme-shop", 29, true))).toBe("acme-shop");
  });

  test("truncates long folder names", () => {
    expect(hubLabel("a-very-long-folder-name-indeed", 3, false).name.length).toBeLessThanOrEqual(21);
  });
});

describe("activityBadge", () => {
  test("joins what happened in the folder", () => {
    expect(activityBadge({ edited: 3, readOnly: 3 })).toBe("3 edited · 3 read");
    expect(activityBadge({ edited: 1, readOnly: 0 })).toBe("1 edited");
    expect(activityBadge({ edited: 0, readOnly: 2 })).toBe("2 read");
  });

  test("says nothing for an untouched folder", () => {
    expect(activityBadge({ edited: 0, readOnly: 0 })).toBeNull();
  });
});
