import type { Pen } from "./canvas-draw";
import { withAlpha } from "./color-math";
import type { Size, Rect } from "./label-place";
import type { Point } from "./placement";

export const LABEL_FONT_SIZE = 10.5;
const PAD_X = 5.5;
const PAD_Y = 2.6;
const PART_GAP = 4;
const PILL_RADIUS = 4;
const SPARK_INNER_RATIO = 0.16;
const SPARK_GLOW_RATIO = 2.6;
const SPARK_GLOW_ALPHA = 0.42;
const SPARK_CORE = "#fff6e8";

export interface LabelPart {
  readonly text: string;
  readonly color: string;
  readonly weight: number;
}

export interface PillColors {
  readonly background: string;
  readonly border: string;
}

export function labelFont(weight: number, family: string): string {
  return `${weight} ${LABEL_FONT_SIZE}px ${family}`;
}

export type Measure = (text: string, weight: number) => number;

/** Text widths are stable per font, and measuring is the slow part of a label pass, so they are remembered. */
export function createMeasurer(pen: Pick<Pen, "measureText" | "font">, family: string): Measure {
  const cache = new Map<string, number>();
  return (text, weight) => {
    const key = `${weight}|${text}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    pen.font = labelFont(weight, family);
    const width = pen.measureText(text).width;
    cache.set(key, width);
    return width;
  };
}

export function pillSize(parts: readonly LabelPart[], measure: Measure): Size {
  const text = parts.reduce((total, part) => total + measure(part.text, part.weight), 0);
  return { width: text + PAD_X * 2 + PART_GAP * Math.max(parts.length - 1, 0), height: LABEL_FONT_SIZE + PAD_Y * 2 };
}

export function drawPill(
  pen: Pen,
  rect: Rect,
  parts: readonly LabelPart[],
  options: PillColors & { family: string; measure: Measure },
): void {
  pen.fillStyle = options.background;
  pen.strokeStyle = options.border;
  pen.lineWidth = 1;
  pen.beginPath();
  pen.roundRect(rect.x, rect.y, rect.width, rect.height, PILL_RADIUS);
  pen.fill();
  pen.stroke();
  const baseline = rect.y + rect.height / 2 + LABEL_FONT_SIZE * 0.34;
  let cursor = rect.x + PAD_X;
  for (const part of parts) {
    pen.font = labelFont(part.weight, options.family);
    pen.fillStyle = part.color;
    pen.fillText(part.text, cursor, baseline);
    cursor += options.measure(part.text, part.weight) + PART_GAP;
  }
}

/** A four-pointed star, the mark for a file the agent has touched; brighter means more recent. */
export interface Spark {
  readonly center: Point;
  readonly radius: number;
  readonly color: string;
  readonly intensity: number;
}

export function drawSpark(pen: Pen, spark: Spark): void {
  const { center, radius, color, intensity } = spark;
  const glow = pen.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * SPARK_GLOW_RATIO);
  glow.addColorStop(0, withAlpha(color, SPARK_GLOW_ALPHA * intensity));
  glow.addColorStop(1, withAlpha(color, 0));
  pen.fillStyle = glow;
  pen.beginPath();
  pen.arc(center.x, center.y, radius * SPARK_GLOW_RATIO, 0, Math.PI * 2);
  pen.fill();
  const inner = radius * SPARK_INNER_RATIO;
  const { x, y } = center;
  pen.fillStyle = withAlpha(color, 0.55 + 0.45 * intensity);
  pen.beginPath();
  pen.moveTo(x, y - radius);
  pen.quadraticCurveTo(x + inner, y - inner, x + radius, y);
  pen.quadraticCurveTo(x + inner, y + inner, x, y + radius);
  pen.quadraticCurveTo(x - inner, y + inner, x - radius, y);
  pen.quadraticCurveTo(x - inner, y - inner, x, y - radius);
  pen.closePath();
  pen.fill();
  pen.fillStyle = withAlpha(SPARK_CORE, 0.5 + 0.5 * intensity);
  pen.beginPath();
  pen.arc(x, y, Math.max(radius * 0.16, 1), 0, Math.PI * 2);
  pen.fill();
}


