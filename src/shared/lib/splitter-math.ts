import { clamp } from "./clamp";

export type SplitterEdge = "left" | "right" | "top";

export interface SizeBounds {
  min: number;
  max: number;
}

export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;

const GROWTH_DIRECTION: Record<SplitterEdge, 1 | -1> = {
  right: 1,
  left: -1,
  top: -1,
};

const KEY_AXIS_SIGN: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

const HORIZONTAL_KEYS = new Set(["ArrowLeft", "ArrowRight"]);
const VERTICAL_KEYS = new Set(["ArrowUp", "ArrowDown"]);

export function sizeAfterDrag(
  edge: SplitterEdge,
  startSize: number,
  pointerDelta: number,
  bounds: SizeBounds,
): number {
  return clamp(startSize + pointerDelta * GROWTH_DIRECTION[edge], bounds.min, bounds.max);
}

interface KeyInput {
  key: string;
  shiftKey: boolean;
}

export function sizeAfterKey(
  edge: SplitterEdge,
  input: KeyInput,
  size: number,
  bounds: SizeBounds,
): number | null {
  if (input.key === "Home") return bounds.min;
  if (input.key === "End") return bounds.max;

  const axisKeys = edge === "top" ? VERTICAL_KEYS : HORIZONTAL_KEYS;
  const sign = KEY_AXIS_SIGN[input.key];
  if (sign === undefined || !axisKeys.has(input.key)) return null;

  const step = input.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
  return clamp(size + sign * GROWTH_DIRECTION[edge] * step, bounds.min, bounds.max);
}
