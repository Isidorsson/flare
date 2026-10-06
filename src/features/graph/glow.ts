import type { Pen } from "./canvas-draw";
import { withAlpha } from "./color-math";
import type { Point } from "./placement";

const SPREAD = 2.1;
const MAX_ASPECT = 3.2;
const MIN_POINTS = 2;
const MID_STOP = 0.5;
const MID_ALPHA = 0.42;

/** An oriented ellipse; `major` and `minor` are radii, `angle` is the direction of the major axis. */
export interface Ellipse {
  readonly cx: number;
  readonly cy: number;
  readonly major: number;
  readonly minor: number;
  readonly angle: number;
}

export interface ViewEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
}

/** Fits the ellipse that covers about two standard deviations of a cloud of points. */
export function fitEllipse(points: readonly Point[]): Ellipse | null {
  if (points.length < MIN_POINTS) return null;
  const count = points.length;
  const cx = points.reduce((sum, point) => sum + point.x, 0) / count;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / count;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    sxx += (point.x - cx) ** 2;
    syy += (point.y - cy) ** 2;
    sxy += (point.x - cx) * (point.y - cy);
  }
  sxx /= count;
  syy /= count;
  sxy /= count;
  const mean = (sxx + syy) / 2;
  const gap = Math.sqrt(Math.max(((sxx - syy) / 2) ** 2 + sxy ** 2, 0));
  const major = Math.sqrt(Math.max(mean + gap, 0)) * SPREAD;
  const minor = Math.max(Math.sqrt(Math.max(mean - gap, 0)) * SPREAD, major / MAX_ASPECT);
  return { cx, cy, major, minor, angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
}

/** Carries an ellipse through the camera by mapping its centre and the ends of its two axes. */
export function projectEllipse(ellipse: Ellipse, toViewport: (point: Point) => Point): ViewEllipse {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const centre = toViewport({ x: ellipse.cx, y: ellipse.cy });
  const majorEnd = toViewport({ x: ellipse.cx + cos * ellipse.major, y: ellipse.cy + sin * ellipse.major });
  const minorEnd = toViewport({ x: ellipse.cx - sin * ellipse.minor, y: ellipse.cy + cos * ellipse.minor });
  return {
    cx: centre.x,
    cy: centre.y,
    rx: Math.hypot(majorEnd.x - centre.x, majorEnd.y - centre.y),
    ry: Math.hypot(minorEnd.x - centre.x, minorEnd.y - centre.y),
    angle: Math.atan2(majorEnd.y - centre.y, majorEnd.x - centre.x),
  };
}

export function withMinimumRadius(ellipse: ViewEllipse, minimum: number): ViewEllipse {
  return { ...ellipse, rx: Math.max(ellipse.rx, minimum), ry: Math.max(ellipse.ry, minimum) };
}

/** A soft radial wash that fades to nothing at the edge of the ellipse. */
export function drawGlow(pen: Pen, ellipse: ViewEllipse, color: string, alpha: number): void {
  pen.save();
  pen.translate(ellipse.cx, ellipse.cy);
  pen.rotate(ellipse.angle);
  pen.scale(ellipse.rx, ellipse.ry);
  const gradient = pen.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, withAlpha(color, alpha));
  gradient.addColorStop(MID_STOP, withAlpha(color, alpha * MID_ALPHA));
  gradient.addColorStop(1, withAlpha(color, 0));
  pen.fillStyle = gradient;
  pen.beginPath();
  pen.arc(0, 0, 1, 0, Math.PI * 2);
  pen.fill();
  pen.restore();
}
