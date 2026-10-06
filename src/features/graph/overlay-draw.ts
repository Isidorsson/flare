import type { Pen } from "./canvas-draw";
import { withAlpha } from "./color-math";
import type { Rect, Size, TrailSegment } from "./comet";
import type { Point } from "./placement";

const CORE_COLOR = "#ffffff";
const COMET_HALO_RADIUS = 16;
const COMET_CORE_RADIUS = 3.2;
const COMET_HALO_ALPHA = 0.55;
const PARTICLE_GLOW_RADIUS = 9;
const PARTICLE_CORE_RADIUS = 2.4;
const PATH_DASH: readonly number[] = [6, 6];
const ARC_DASH: readonly number[] = [7, 6];
const ARC_LINE_WIDTH = 1.3;
const ARC_ALPHA = 0.72;
const SELECTION_DASH: readonly number[] = [3, 3];
const PATH_LINE_WIDTH = 1.2;
const CHANGED_RING_WIDTH = 1;
const PILL_PADDING_X = 8;
const PILL_PADDING_Y = 4;
const PILL_GAP = 8;
const PILL_RADIUS = 6;
const PILL_FONT_SIZE = 11;

export interface RingShape extends Point {
  radius: number;
  width: number;
  alpha: number;
  color: string;
}

export interface PillContent {
  name: string;
  text: string;
  fontFamily: string;
}

export interface PillColors {
  background: string;
  border: string;
  name: string;
  text: string;
}

export function drawRing(context: Pen, ring: RingShape): void {
  context.strokeStyle = withAlpha(ring.color, ring.alpha);
  context.lineWidth = ring.width;
  context.beginPath();
  context.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
  context.stroke();
}

export function drawChangedRing(context: Pen, center: Point, nodeRadius: number, color: string): void {
  drawRing(context, { ...center, radius: nodeRadius * 2 + 3, width: CHANGED_RING_WIDTH, alpha: 0.7, color });
}

export function drawTrail(context: Pen, segments: readonly TrailSegment[], color: string): void {
  context.lineCap = "round";
  for (const segment of segments) {
    context.strokeStyle = withAlpha(color, segment.alpha);
    context.lineWidth = segment.width;
    context.beginPath();
    context.moveTo(segment.from.x, segment.from.y);
    context.lineTo(segment.to.x, segment.to.y);
    context.stroke();
  }
}

export function drawCometHead(context: Pen, head: Point, color: string, pulse: number): void {
  const radius = COMET_HALO_RADIUS * (0.85 + 0.15 * pulse);
  const gradient = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, radius);
  gradient.addColorStop(0, withAlpha(color, COMET_HALO_ALPHA));
  gradient.addColorStop(1, withAlpha(color, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(head.x, head.y, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = CORE_COLOR;
  context.beginPath();
  context.arc(head.x, head.y, COMET_CORE_RADIUS, 0, Math.PI * 2);
  context.fill();
}

export function drawParticle(context: Pen, head: Point, tail: Point, color: string): void {
  context.lineCap = "round";
  context.strokeStyle = withAlpha(color, 0.65);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(tail.x, tail.y);
  context.lineTo(head.x, head.y);
  context.stroke();
  const glow = context.createRadialGradient(head.x, head.y, 0, head.x, head.y, PARTICLE_GLOW_RADIUS);
  glow.addColorStop(0, withAlpha(color, 0.9));
  glow.addColorStop(1, withAlpha(color, 0));
  context.fillStyle = glow;
  context.beginPath();
  context.arc(head.x, head.y, PARTICLE_GLOW_RADIUS, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = CORE_COLOR;
  context.beginPath();
  context.arc(head.x, head.y, PARTICLE_CORE_RADIUS, 0, Math.PI * 2);
  context.fill();
}

export function drawPathSegment(
  context: Pen,
  segment: { from: Point; to: Point; alpha: number; dashOffset: number; color: string },
): void {
  context.setLineDash([...PATH_DASH]);
  context.lineDashOffset = segment.dashOffset;
  context.lineWidth = PATH_LINE_WIDTH;
  context.strokeStyle = withAlpha(segment.color, segment.alpha);
  context.beginPath();
  context.moveTo(segment.from.x, segment.from.y);
  context.lineTo(segment.to.x, segment.to.y);
  context.stroke();
  context.setLineDash([]);
}

export interface ArcShape {
  from: Point;
  to: Point;
  control: Point;
  color: string;
  dashOffset: number;
}

/** A dashed curve whose dashes travel from its start to its end as the offset falls. */
export function drawArc(context: Pen, arc: ArcShape): void {
  context.setLineDash([...ARC_DASH]);
  context.lineDashOffset = arc.dashOffset;
  context.lineWidth = ARC_LINE_WIDTH;
  context.lineCap = "butt";
  context.strokeStyle = withAlpha(arc.color, ARC_ALPHA);
  context.beginPath();
  context.moveTo(arc.from.x, arc.from.y);
  context.quadraticCurveTo(arc.control.x, arc.control.y, arc.to.x, arc.to.y);
  context.stroke();
  context.setLineDash([]);
}

export function drawSelectionRing(context: Pen, center: Point, radius: number, color: string): void {
  context.setLineDash([...SELECTION_DASH]);
  context.lineDashOffset = 0;
  drawRing(context, { ...center, radius, width: 1.2, alpha: 0.9, color });
  context.setLineDash([]);
}

function pillFont(weight: number, fontFamily: string): string {
  return `${weight} ${PILL_FONT_SIZE}px ${fontFamily}`;
}

export function measurePill(context: Pen, content: PillContent): Size {
  context.font = pillFont(600, content.fontFamily);
  const nameWidth = context.measureText(content.name).width;
  context.font = pillFont(500, content.fontFamily);
  const textWidth = context.measureText(content.text).width;
  return {
    width: PILL_PADDING_X * 2 + nameWidth + PILL_GAP + textWidth,
    height: PILL_FONT_SIZE + PILL_PADDING_Y * 2,
  };
}

export function drawPill(
  context: Pen,
  rect: Rect,
  content: PillContent,
  colors: PillColors,
): void {
  context.fillStyle = colors.background;
  context.strokeStyle = colors.border;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, PILL_RADIUS);
  context.fill();
  context.stroke();
  const baseline = rect.y + rect.height / 2 + PILL_FONT_SIZE / 3;
  context.font = pillFont(600, content.fontFamily);
  context.fillStyle = colors.name;
  context.fillText(content.name, rect.x + PILL_PADDING_X, baseline);
  const nameWidth = context.measureText(content.name).width;
  context.font = pillFont(500, content.fontFamily);
  context.fillStyle = colors.text;
  context.fillText(content.text, rect.x + PILL_PADDING_X + nameWidth + PILL_GAP, baseline);
}
