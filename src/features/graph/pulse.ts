export type PulseKind = "read" | "change";

export interface Pulse {
  readonly kind: PulseKind;
  readonly startedAt: number;
}

export const PULSE_DURATION_MS = 2400;

export function pulseClock(): number {
  return performance.now();
}

export function pulseIntensity(pulse: Pulse, now: number, reducedMotion: boolean): number {
  const elapsed = now - pulse.startedAt;
  if (elapsed < 0 || elapsed >= PULSE_DURATION_MS) return 0;
  if (reducedMotion) return 1;
  const remaining = 1 - elapsed / PULSE_DURATION_MS;
  return remaining * remaining;
}

export function isPulseActive(pulse: Pulse, now: number): boolean {
  return now - pulse.startedAt < PULSE_DURATION_MS;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
