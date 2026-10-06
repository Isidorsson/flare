import { describe, expect, test } from "bun:test";

import { createMeasurer, drawPill, drawSpark, labelFont, pillSize } from "./label-draw";
import { RecordingPen } from "./pen-fixture";

describe("createMeasurer", () => {
  test("measures each text once per weight", () => {
    const pen = new RecordingPen();
    let calls = 0;
    const counting = {
      get font() {
        return pen.font;
      },
      set font(value: string) {
        pen.font = value;
      },
      measureText: (text: string) => {
        calls += 1;
        return pen.measureText(text);
      },
    };
    const measure = createMeasurer(counting, "monospace");
    expect(measure("hello", 500)).toBe(30);
    expect(measure("hello", 500)).toBe(30);
    expect(calls).toBe(1);
    measure("hello", 600);
    expect(calls).toBe(2);
    expect(pen.font).toBe(labelFont(600, "monospace"));
  });
});

describe("pillSize", () => {
  const measure = (text: string) => text.length * 6;

  test("adds padding around the text and a gap between parts", () => {
    const single = pillSize([{ text: "abcd", color: "#fff", weight: 500 }], measure);
    const double = pillSize(
      [
        { text: "abcd", color: "#fff", weight: 500 },
        { text: "12", color: "#fff", weight: 500 },
      ],
      measure,
    );
    expect(single.width).toBeGreaterThan(24);
    expect(double.width).toBeGreaterThan(single.width + 12);
    expect(single.height).toBe(double.height);
  });
});

describe("drawPill", () => {
  test("paints the box and each part left to right", () => {
    const pen = new RecordingPen();
    const parts = [
      { text: "src/", color: "#aaaaaa", weight: 600 },
      { text: "15", color: "#777777", weight: 500 },
    ];
    drawPill(pen, { x: 10, y: 20, width: 80, height: 16 }, parts, {
      background: "rgba(0,0,0,0.8)",
      border: "rgba(255,255,255,0.2)",
      family: "monospace",
      measure: (text) => text.length * 6,
    });
    expect(pen.texts).toEqual(["src/", "15"]);
    expect(pen.rects).toEqual([{ x: 10, y: 20, width: 80, height: 16 }]);
    expect(pen.strokes).toHaveLength(1);
  });
});

describe("drawSpark", () => {
  test("draws a glow, a four-pointed star and a bright core, dimmer when older", () => {
    const bright = new RecordingPen();
    drawSpark(bright, { center: { x: 50, y: 50 }, radius: 8, color: "#ff9f4a", intensity: 1 });
    expect(bright.fills).toBe(3);
    expect(bright.stops).toHaveLength(2);
    const dim = new RecordingPen();
    drawSpark(dim, { center: { x: 50, y: 50 }, radius: 8, color: "#ff9f4a", intensity: 0.2 });
    const alpha = (stops: [number, string][]) => Number(/, ([\d.]+)\)$/.exec(stops[0]?.[1] ?? "")?.[1]);
    expect(alpha(dim.stops)).toBeLessThan(alpha(bright.stops));
  });
});
