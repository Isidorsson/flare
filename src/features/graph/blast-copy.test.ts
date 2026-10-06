import { describe, expect, test } from "bun:test";

import { blastSummary, blastToggleDetail, DEPTH_LABELS } from "./blast-copy";
import { BLAST_FADE_PER_HOP } from "./palette";

describe("blastSummary", () => {
  test("names the file and counts what depends on it", () => {
    expect(blastSummary("src/lib/cart.ts", 4)).toBe("4 files depend on cart.ts");
    expect(blastSummary("src/lib/cart.ts", 1)).toBe("1 file depends on cart.ts");
    expect(blastSummary("src/lib/cart.ts", 0)).toBe("Nothing imports cart.ts");
  });
});

describe("blastToggleDetail", () => {
  test("says what pressing the toggle will do in each state", () => {
    expect(blastToggleDetail(false, true)).toContain("Colour everything that depends");
    expect(blastToggleDetail(true, false)).toContain("select a file");
    expect(blastToggleDetail(true, true)).toContain("direct imports only");
  });
});

describe("depth legend", () => {
  test("has one label for each blast colour the palette fades through", () => {
    expect(DEPTH_LABELS).toHaveLength(BLAST_FADE_PER_HOP.length);
  });
});
