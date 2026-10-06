import { MAX_MATCH_LINES } from "@flare/protocol";

/** Every duration, delay and cap of the live file view. The CSS gets the animation ones as custom properties. */
export const LIVE = {
  read: {
    maxHighlightLines: 300,
    maxMatchLines: MAX_MATCH_LINES,
    clearMs: 7000,
    waveMs: 1900,
    staggerMs: 40,
  },
  edit: {
    mergeGapLines: 6,
    maxSteps: 8,
    maxStepsWhenBusy: 1,
    maxPhantomLines: 30,
    stepPauseBaseMs: 700,
    stepPausePerLineMs: 30,
    stepPauseMaxMs: 2400,
    sweepMs: 450,
    textInMs: 350,
    staggerMs: 38,
    maxStaggerLines: 120,
    fadeDelayMs: 3000,
    fadeMs: 5000,
    phantomInMs: 300,
    phantomFadeDelayMs: 2000,
    phantomFadeMs: 600,
    settleStepPauseMs: 500,
    settleFadeDelayMs: 1000,
    settleFadeMs: 2500,
  },
  pacing: {
    maxQueued: 3,
    afterRead: { busyMs: 380, idleMs: 650 },
    afterEdit: { busyMs: 300, idleMs: 700 },
  },
  follow: { typedGraceMs: 6000, pickedGraceMs: 12000 },
  heat: {
    decayMs: 240_000,
    floor: 0.04,
    repaintMs: 10_000,
    badges: 5,
    levels: 10,
    editWeight: 0.3,
    lineDivisor: 60,
    readWeight: 0.1,
    base: 0.45,
    span: 0.55,
  },
  tab: { pulseMs: 5000, pulseCycles: 5 },
  caret: { blinkMs: 1060 },
} as const;

/**
 * Time after the start of a step by which all of its decorations have faded
 * out. A step that settles an edit already typed on screen fades sooner and
 * has no stagger.
 */
export function clearDelayMs(changedLines: number, settled: boolean): number {
  if (settled) return LIVE.edit.settleFadeDelayMs + LIVE.edit.settleFadeMs;
  const lines = Math.min(changedLines, LIVE.edit.maxStaggerLines);
  return LIVE.edit.fadeDelayMs + LIVE.edit.fadeMs + lines * LIVE.edit.staggerMs;
}

/** Pause before the next step of an edit, longer for bigger steps. */
export function stepPauseMs(changedLines: number): number {
  const { stepPauseBaseMs, stepPausePerLineMs, stepPauseMaxMs } = LIVE.edit;
  return Math.min(stepPauseMaxMs, stepPauseBaseMs + changedLines * stepPausePerLineMs);
}

const ms = (value: number): string => `${String(value)}ms`;

/** The animation timings the stylesheet reads, so the numbers live in one place. */
export function cssTimingVariables(): Record<string, string> {
  const { read, edit, caret } = LIVE;
  return {
    "--flare-read-wave": ms(read.waveMs),
    "--flare-read-step": ms(read.staggerMs),
    "--flare-add-sweep": ms(edit.sweepMs),
    "--flare-add-text": ms(edit.textInMs),
    "--flare-add-step": ms(edit.staggerMs),
    "--flare-add-fade-delay": ms(edit.fadeDelayMs),
    "--flare-add-fade": ms(edit.fadeMs),
    "--flare-settle-fade-delay": ms(edit.settleFadeDelayMs),
    "--flare-settle-fade": ms(edit.settleFadeMs),
    "--flare-phantom-in": ms(edit.phantomInMs),
    "--flare-phantom-fade-delay": ms(edit.phantomFadeDelayMs),
    "--flare-phantom-fade": ms(edit.phantomFadeMs),
    "--flare-caret-blink": ms(caret.blinkMs),
    "--flare-tab-pulse": ms(LIVE.tab.pulseMs / LIVE.tab.pulseCycles),
    "--flare-tab-pulse-cycles": String(LIVE.tab.pulseCycles),
    "--flare-tab-pulse-total": ms(LIVE.tab.pulseMs),
  };
}
