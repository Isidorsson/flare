import { describe, expect, test } from "bun:test";
import { compile } from "tailwindcss";

import { addedDecorations, markDecorations, readDecorations, typingDecorations, type Ruler } from "./decorations";
import { groupSteps } from "./edit-steps";
import { diffLines } from "./line-diff";
import { planRead } from "./read-plan";
import { cssTimingVariables } from "./timing";

const css = await Bun.file(new URL("./live.css", import.meta.url)).text();

// Custom properties that widgets.ts sets on the elements it creates.
const SET_BY_WIDGETS = ["--flare-line-height"];

// Class names that widgets.ts and the React components put on elements themselves.
const ELEMENT_CLASSES = [
  "flare-caret",
  "flare-caret-bar",
  "flare-caret-tag",
  "flare-label",
  "flare-label-read",
  "flare-label-edit",
  "flare-typing-panel",
  "flare-typing-panel-title",
  "flare-typing-panel-text",
  "flare-phantom",
  "flare-phantom-persist",
  "flare-phantom-line",
  "flare-phantom-more",
  "flare-tab-dot",
  "flare-heat",
  "flare-spark",
];

// The lane is Monaco's own enum, which cannot be loaded here, so the test stands in a value of the same shape.
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
const RULER: Ruler = { color: "#000000", lane: 1 };

function classesFromDecorations(): string[] {
  const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${String(index + 1)}\n`).join("");
  const [step] = groupSteps(diffLines(numbered(300), numbered(300).replace("line 5\n", "changed\n")));
  const big = groupSteps(diffLines("", numbered(300)))[0];
  if (step === undefined || big === undefined) throw new Error("expected steps");
  const info = { lineCount: 300, maxColumn: () => 10 };
  const plan = planRead({ range: { start: 1, end: 300 }, pattern: null, matchLines: null }, 300);
  const decorations = [
    ...readDecorations(plan),
    ...addedDecorations(step, info, { settled: false }),
    ...addedDecorations(big, info, { settled: false }),
    ...addedDecorations(big, info, { settled: true }),
    ...markDecorations({ added: [{ start: 1, end: 2 }], removedAt: [3, 400] }, info, RULER),
    ...typingDecorations({ line: 1, column: 1 }, { line: 2, column: 3 }),
  ];
  const names = decorations.flatMap(({ options }) => [options.className, options.inlineClassName, options.linesDecorationsClassName]);
  return [...new Set(names.flatMap((name) => (name === undefined || name === null ? [] : name.split(" "))))];
}

describe("live.css", () => {
  test("is valid CSS that the stylesheet pipeline can read", async () => {
    const compiler = await compile(css);
    expect(compiler.build([])).toContain(".flare-wave");
  });

  test("styles every class the decorations put on lines, including the longest stagger", () => {
    const classes = classesFromDecorations();
    expect(classes.length).toBeGreaterThan(10);
    for (const name of classes) expect(css).toContain(`.${name}`);
    expect(classes).toContain("flare-su9");
    expect(classes).toContain("flare-st29");
  });

  test("styles every class the widgets and components use", () => {
    for (const name of ELEMENT_CLASSES) expect(css).toContain(`.${name}`);
  });

  test("reads every animation timing from a variable that timing.ts sets, and uses all of them", () => {
    const provided = Object.keys(cssTimingVariables());
    const used = new Set([...css.matchAll(/var\((--flare-[a-z-]+)/g)].map((match) => match[1]));
    const definedHere = new Set([...css.matchAll(/(--flare-[a-z-]+):/g)].map((match) => match[1]));
    for (const name of used) {
      const known = provided.includes(name ?? "") || definedHere.has(name ?? "") || SET_BY_WIDGETS.includes(name ?? "");
      expect(known).toBe(true);
    }
    for (const name of provided) expect(used.has(name)).toBe(true);
  });

  test("takes its colours from the design tokens rather than writing its own", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain("var(--color-claude)");
    expect(css).toContain("var(--color-read)");
  });
});
