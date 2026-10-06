import type { NodeHoverDrawingFunction } from "sigma/rendering";

import { withAlpha } from "./color-math";
import type { EdgeAttrs, NodeAttrs } from "./graph-model";
import type { Palette } from "./palette";

type Drawing = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineDashOffset"
  | "font"
  | "save"
  | "restore"
  | "clearRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "roundRect"
  | "fill"
  | "stroke"
  | "fillText"
  | "setLineDash"
  | "createRadialGradient"
>;

/** The slice of the 2D context the graph overlay draws with, so drawing can be recorded in tests. */
export type Pen = Drawing & { measureText: (text: string) => { width: number } };

const HALO_RADIUS_FACTOR = 3.4;
const HALO_INNER_FACTOR = 0.6;
const HALO_PEAK_ALPHA = 0.6;
const LABEL_PADDING = 4;
const LABEL_CORNER_RADIUS = 4;
const LABEL_GAP = 3;

export interface Halo {
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
}

export function drawHalo(context: Pen, halo: Halo): void {
  const outer = halo.radius * HALO_RADIUS_FACTOR;
  const gradient = context.createRadialGradient(
    halo.x,
    halo.y,
    halo.radius * HALO_INNER_FACTOR,
    halo.x,
    halo.y,
    outer,
  );
  gradient.addColorStop(0, withAlpha(halo.color, HALO_PEAK_ALPHA * halo.intensity));
  gradient.addColorStop(1, withAlpha(halo.color, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(halo.x, halo.y, outer, 0, Math.PI * 2);
  context.fill();
}

export function createHoverDrawer(palette: Palette): NodeHoverDrawingFunction<NodeAttrs, EdgeAttrs> {
  return (context, data, settings) => {
    const label = data.label;
    if (typeof label !== "string" || label === "") return;
    context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
    const width = context.measureText(label).width + LABEL_PADDING * 2;
    const height = settings.labelSize + LABEL_PADDING * 2;
    const left = data.x + data.size + LABEL_GAP;
    context.fillStyle = palette.panel;
    context.strokeStyle = palette.dim;
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(left, data.y - height / 2, width, height, LABEL_CORNER_RADIUS);
    context.fill();
    context.stroke();
    context.fillStyle = palette.labelStrong;
    context.fillText(label, left + LABEL_PADDING, data.y + settings.labelSize / 3);
  };
}
