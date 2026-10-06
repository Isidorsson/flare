import { describe, expect, test } from "bun:test";

import {
  addedDecorations,
  caretAfterStep,
  markDecorations,
  readDecorations,
  staggerClasses,
  typingDecorations,
  type LineInfo,
  type Ruler,
} from "./decorations";
import { groupSteps } from "./edit-steps";
import { diffLines } from "./line-diff";
import { planRead } from "./read-plan";

// The lane is Monaco's own enum, which cannot be loaded here, so the test stands in a value of the same shape.
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
const RULER: Ruler = { color: "#5fd38d", lane: 1 };
const info = (lineCount: number): LineInfo => ({ lineCount, maxColumn: (line) => (line % 7 === 0 ? 1 : 20) });

function step(before: string, after: string) {
  const [first] = groupSteps(diffLines(before, after));
  if (first === undefined) throw new Error("expected a step");
  return first;
}

const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${String(index + 1)}\n`).join("");

describe("staggerClasses", () => {
  test.each([
    [0, "flare-su0 flare-st0"],
    [7, "flare-su7 flare-st0"],
    [10, "flare-su0 flare-st1"],
    [123, "flare-su3 flare-st12"],
  ])("splits index %i into a ones class and a tens class", (index, classes) => {
    expect(staggerClasses(index, 300)).toBe(classes);
  });

  test("holds at the last index and never goes negative", () => {
    expect(staggerClasses(500, 119)).toBe("flare-su9 flare-st11");
    expect(staggerClasses(-4, 119)).toBe("flare-su0 flare-st0");
  });
});

describe("readDecorations", () => {
  test("puts a staggered wave and a cyan gutter bar on every lit line", () => {
    const plan = planRead({ range: { start: 3, end: 5 }, pattern: null, matchLines: null }, 50);
    const decorations = readDecorations(plan);
    expect(decorations.map((decoration) => decoration.range.startLineNumber)).toEqual([3, 4, 5]);
    expect(decorations[0]?.options).toMatchObject({
      isWholeLine: true,
      className: "flare-wave flare-su0 flare-st0",
      linesDecorationsClassName: "flare-bar flare-bar-read",
    });
    expect(decorations[2]?.options.className).toBe("flare-wave flare-su2 flare-st0");
  });

  test("lights nothing for a search without matches", () => {
    const plan = planRead({ range: null, pattern: "x", matchLines: [] }, 50);
    expect(readDecorations(plan)).toEqual([]);
  });
});

describe("addedDecorations", () => {
  const edit = step(numbered(30), numbered(30).replace("line 10\n", "ten\nten and a half\n"));

  test("sweeps in each added line a little after the one before and fades its text in", () => {
    const decorations = addedDecorations(edit, info(31), { settled: false });
    expect(decorations.map((decoration) => decoration.range.startLineNumber)).toEqual([10, 11]);
    expect(decorations[0]?.options).toMatchObject({
      isWholeLine: true,
      className: "flare-add flare-su0 flare-st0",
      inlineClassName: "flare-add-text flare-su0 flare-st0",
      linesDecorationsClassName: "flare-bar flare-bar-add flare-fade-out",
    });
    expect(decorations[1]?.options.className).toBe("flare-add flare-su1 flare-st0");
  });

  test("covers the text of the line so it can fade in, but not an empty line", () => {
    const [lineTen, lineEleven] = addedDecorations(edit, { lineCount: 31, maxColumn: (line) => (line === 11 ? 1 : 4) }, { settled: false });
    expect(lineTen?.range.endColumn).toBe(4);
    expect(lineEleven?.options.inlineClassName).toBeUndefined();
  });

  test("shows an edit that was already typed out at once, without the text fading in again", () => {
    const [first, second] = addedDecorations(edit, info(31), { settled: true });
    expect(first?.options.className).toBe("flare-add flare-add-settled");
    expect(second?.options.className).toBe("flare-add flare-add-settled");
    expect(first?.options.inlineClassName).toBeUndefined();
    expect(first?.options.linesDecorationsClassName).toBe("flare-bar flare-bar-add flare-fade-out flare-fade-out-settled");
  });

  test("caps the stagger so a big edit does not wait forever", () => {
    const big = step("", numbered(200));
    const decorations = addedDecorations(big, info(200), { settled: false });
    expect(decorations).toHaveLength(200);
    expect(decorations[150]?.options.className).toBe("flare-add flare-su9 flare-st11");
    expect(decorations[199]?.options.className).toBe("flare-add flare-su9 flare-st11");
  });

  test("leaves out lines the file no longer has", () => {
    expect(addedDecorations(edit, info(10), { settled: false }).map((decoration) => decoration.range.startLineNumber)).toEqual([10]);
  });

  test("puts nothing on a step that only removed lines", () => {
    const removal = step(numbered(10), numbered(10).replace("line 4\n", ""));
    expect(addedDecorations(removal, info(9), { settled: false })).toEqual([]);
  });
});

describe("caretAfterStep", () => {
  test("sits at the end of the last added line", () => {
    const edit = step(numbered(10), numbered(10).replace("line 3\n", "three\nthree b\n"));
    expect(caretAfterStep(edit, { lineCount: 11, maxColumn: (line) => line * 2 })).toEqual({ line: 4, column: 8 });
  });

  test("is absent when nothing was added", () => {
    const removal = step(numbered(10), numbered(10).replace("line 4\n", ""));
    expect(caretAfterStep(removal, info(9))).toBeNull();
  });
});

describe("markDecorations", () => {
  test("marks added lines with a thin bar and a ruler tick, and removals with a small marker", () => {
    const decorations = markDecorations({ added: [{ start: 4, end: 6 }], removedAt: [9] }, info(20), RULER);
    expect(decorations).toHaveLength(2);
    expect(decorations[0]).toMatchObject({
      range: { startLineNumber: 4, endLineNumber: 6 },
      options: {
        isWholeLine: true,
        linesDecorationsClassName: "flare-mark flare-mark-add",
        overviewRuler: { color: "#5fd38d", position: 1 },
      },
    });
    expect(decorations[1]).toMatchObject({
      range: { startLineNumber: 9 },
      options: { linesDecorationsClassName: "flare-mark flare-mark-removed" },
    });
  });

  test("clamps spans to the file and drops those past its end", () => {
    const decorations = markDecorations({ added: [{ start: 18, end: 40 }, { start: 30, end: 31 }], removedAt: [] }, info(20), RULER);
    expect(decorations).toHaveLength(1);
    expect(decorations[0]?.range).toMatchObject({ startLineNumber: 18, endLineNumber: 20 });
  });

  test("marks a removal at the very end below the last line", () => {
    const [mark] = markDecorations({ added: [], removedAt: [21] }, info(20), RULER);
    expect(mark?.range.startLineNumber).toBe(20);
    expect(mark?.options.linesDecorationsClassName).toBe("flare-mark flare-mark-removed flare-mark-removed-end");
  });

  test("has no marks for a turn that left the file alone", () => {
    expect(markDecorations({ added: [], removedAt: [] }, info(5), RULER)).toEqual([]);
  });
});

describe("typingDecorations", () => {
  test("tints the lines and brightens the typed characters", () => {
    const decorations = typingDecorations({ line: 3, column: 5 }, { line: 5, column: 2 });
    expect(decorations).toHaveLength(2);
    expect(decorations[0]).toMatchObject({
      range: { startLineNumber: 3, endLineNumber: 5 },
      options: { isWholeLine: true, className: "flare-typing-line" },
    });
    expect(decorations[1]?.range).toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 5, endColumn: 2 });
  });

  test("tints only the line while nothing has been typed", () => {
    expect(typingDecorations({ line: 3, column: 5 }, { line: 3, column: 5 })).toHaveLength(1);
  });
});
