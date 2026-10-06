import type { Pen } from "./canvas-draw";

export interface Stroke {
  readonly color: unknown;
  readonly width: number;
  readonly dashed: boolean;
}

export interface RoundRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A canvas stand-in that records what a drawing routine asked for, for tests. */
export class RecordingPen implements Pen {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineDashOffset = 0;
  font = "";
  readonly texts: string[] = [];
  readonly strokes: Stroke[] = [];
  readonly arcs: { x: number; y: number; radius: number }[] = [];
  readonly rects: RoundRect[] = [];
  readonly calls: string[] = [];
  readonly stops: [number, string][] = [];
  fills = 0;
  private dashed = false;

  save = () => {
    this.calls.push("save");
  };
  restore = () => {
    this.calls.push("restore");
  };
  clearRect = () => undefined;
  beginPath = () => undefined;
  moveTo = () => undefined;
  lineTo = () => undefined;
  quadraticCurveTo = () => undefined;
  closePath = () => undefined;
  ellipse = () => undefined;
  translate = () => {
    this.calls.push("translate");
  };
  rotate = () => {
    this.calls.push("rotate");
  };
  scale = () => {
    this.calls.push("scale");
  };
  fillRect = () => undefined;
  roundRect = (x: number, y: number, width: number, height: number) => {
    this.rects.push({ x, y, width, height });
  };
  fill = () => {
    this.fills += 1;
  };
  stroke = () => {
    this.strokes.push({ color: this.strokeStyle, width: this.lineWidth, dashed: this.dashed });
  };
  arc = (x: number, y: number, radius: number) => {
    this.arcs.push({ x, y, radius });
  };
  fillText = (text: string) => {
    this.texts.push(text);
  };
  measureText = (text: string) => ({ width: text.length * 6 });
  setLineDash = (segments: number[]) => {
    this.dashed = segments.length > 0;
  };
  createRadialGradient = () => ({
    addColorStop: (at: number, color: string) => {
      this.stops.push([at, color]);
    },
  });
}
