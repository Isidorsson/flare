export const RELAX_ROUNDS = 36;
export const SETTLE_ROUNDS = 14;
export const RELAX_PULL = 0.22;
export const SEPARATION_PASSES_PER_ROUND = 2;
export const SEPARATION_GAP_PX = 2.4;
export const FINAL_SEPARATION_PASSES = 160;
export const FALLBACK_VIEWPORT_PX = 600;
export const FIT_PADDING_PX = 72;
const SPAN_ALLOWANCE = 1.22;
const MIN_SPAN = 1e-6;

/**
 * Graph units per screen pixel once the layout is fitted to the viewport. Node radii are pixels and positions are not,
 * so this converts one into the other; the allowance leaves room for the layout to grow while it is pushed apart.
 */
export function unitsPerPixel(span: number, viewportPx: number): number {
  return (Math.max(span, MIN_SPAN) * SPAN_ALLOWANCE) / Math.max(viewportPx - FIT_PADDING_PX, 1);
}
