import type { NodeHoverDrawingFunction } from "sigma/rendering";

import { withAlpha } from "./color-math";
import type { EdgeAttrs, NodeAttrs } from "./graph-model";

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
  | "quadraticCurveTo"
  | "closePath"
  | "ellipse"
  | "translate"
  | "rotate"
  | "scale"
  | "fillRect"
>;

/** The slice of the 2D context the graph overlay draws with, so drawing can be recorded in tests. */
export type Pen = Drawing & { measureText: (text: string) => { width: number } };

const HALO_RADIUS_FACTOR = 3.4;
const HALO_INNER_FACTOR = 0.6;
const HALO_PEAK_ALPHA = 0.6;

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

export const noHoverDrawing: NodeHoverDrawingFunction<NodeAttrs, EdgeAttrs> = () => undefined;

