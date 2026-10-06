import { describe, expect, test } from "bun:test";

import { drawGlow, fitEllipse, projectEllipse, withMinimumRadius } from "./glow";
import { RecordingPen } from "./pen-fixture";

function cloud(count: number, width: number, height: number, angle = 0): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const u = ((index * 7919) % 1000) / 1000 - 0.5;
    const v = ((index * 104729) % 1000) / 1000 - 0.5;
    const x = u * width;
    const y = v * height;
    return { x: x * Math.cos(angle) - y * Math.sin(angle) + 50, y: x * Math.sin(angle) + y * Math.cos(angle) - 20 };
  });
}

describe("fitEllipse", () => {
  test("needs at least two points", () => {
    expect(fitEllipse([])).toBeNull();
    expect(fitEllipse([{ x: 1, y: 1 }])).toBeNull();
  });

  test("centres on the cloud", () => {
    const ellipse = fitEllipse(cloud(300, 100, 40));
    expect(ellipse?.cx).toBeCloseTo(50, 0);
    expect(ellipse?.cy).toBeCloseTo(-20, 0);
  });

  test("stretches along the long direction of the cloud", () => {
    const flat = fitEllipse(cloud(400, 120, 20));
    expect(flat?.major).toBeGreaterThan((flat?.minor ?? 0) * 2);
    expect(Math.abs(Math.sin(flat?.angle ?? 1))).toBeLessThan(0.2);
    const tilted = fitEllipse(cloud(400, 120, 20, Math.PI / 4));
    expect(Math.abs(Math.tan(tilted?.angle ?? 0))).toBeCloseTo(1, 0);
  });

  test("keeps a line of points from collapsing into a needle", () => {
    const line = fitEllipse(Array.from({ length: 10 }, (_, index) => ({ x: index * 10, y: 0 })));
    expect(line?.minor).toBeGreaterThan(0);
    expect((line?.major ?? 0) / (line?.minor ?? 1)).toBeLessThanOrEqual(3.21);
  });
});

describe("projectEllipse", () => {
  test("scales and moves the ellipse with the camera", () => {
    const ellipse = { cx: 10, cy: 0, major: 20, minor: 10, angle: 0 };
    const view = projectEllipse(ellipse, (point) => ({ x: point.x * 2 + 5, y: point.y * 2 }));
    expect(view).toMatchObject({ cx: 25, cy: 0, rx: 40, ry: 20 });
    expect(view.angle).toBeCloseTo(0);
  });

  test("survives a flipped axis", () => {
    const ellipse = { cx: 0, cy: 0, major: 10, minor: 5, angle: 0 };
    const view = projectEllipse(ellipse, (point) => ({ x: point.x, y: -point.y }));
    expect(view.rx).toBeCloseTo(10);
    expect(view.ry).toBeCloseTo(5);
  });

  test("enforces a minimum radius", () => {
    expect(withMinimumRadius({ cx: 0, cy: 0, rx: 3, ry: 40, angle: 0 }, 12)).toMatchObject({ rx: 12, ry: 40 });
  });
});

describe("drawGlow", () => {
  test("paints one gradient fill that fades to transparent", () => {
    const pen = new RecordingPen();
    drawGlow(pen, { cx: 1, cy: 2, rx: 30, ry: 10, angle: 0.3 }, "#336699", 0.2);
    expect(pen.fills).toBe(1);
    expect(pen.calls[0]).toBe("save");
    expect(pen.calls.at(-1)).toBe("restore");
    expect(pen.stops[0]?.[1]).toBe("rgba(51, 102, 153, 0.200)");
    expect(pen.stops.at(-1)?.[1]).toBe("rgba(51, 102, 153, 0.000)");
  });
});
