import { diffLines, type LineHunk } from "./line-diff";
import { LIVE, stepPauseMs } from "./timing";

/** Hunks that sit close together, played as one beat. */
export interface EditStep {
  hunks: LineHunk[];
  firstLine: number;
  lastLine: number;
  added: number;
  removed: number;
}

export interface EditPlan {
  steps: EditStep[];
  // How many steps the change has in all, including those left out of the playback.
  totalSteps: number;
  created: boolean;
}

export interface PlanOptions {
  // Other actions are waiting, so the edit is shown in a single beat to let the view catch up.
  busy: boolean;
}

function lastLineOf(hunk: LineHunk): number {
  return hunk.newStart + Math.max(hunk.newCount, 1) - 1;
}

function stepOf(hunks: LineHunk[]): EditStep {
  const first = hunks[0];
  const last = hunks.at(-1);
  if (first === undefined || last === undefined) throw new Error("A step needs at least one hunk");
  return {
    hunks,
    firstLine: first.newStart,
    lastLine: lastLineOf(last),
    added: hunks.reduce((sum, hunk) => sum + hunk.newCount, 0),
    removed: hunks.reduce((sum, hunk) => sum + hunk.oldCount, 0),
  };
}

/** Merges hunks that are closer together than the gap into one step. */
export function groupSteps(hunks: readonly LineHunk[], gap: number = LIVE.edit.mergeGapLines): EditStep[] {
  const groups: LineHunk[][] = [];
  for (const hunk of hunks) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group !== undefined && previous !== undefined && hunk.newStart - (previous.newStart + previous.newCount) < gap) {
      group.push(hunk);
    } else {
      groups.push([hunk]);
    }
  }
  return groups.map(stepOf);
}

/** The steps to play for a change, never more than the playback limit. */
export function planEdit(before: string | null, after: string, { busy }: PlanOptions): EditPlan {
  const steps = groupSteps(diffLines(before ?? "", after));
  const limit = busy ? LIVE.edit.maxStepsWhenBusy : LIVE.edit.maxSteps;
  return { steps: steps.slice(0, limit), totalSteps: steps.length, created: before === null };
}

export function changedLines(step: EditStep): number {
  return step.added + step.removed;
}

export function pauseAfterStepMs(step: EditStep, settled: boolean): number {
  return settled ? LIVE.edit.settleStepPauseMs : stepPauseMs(changedLines(step));
}

export interface EditLabelParts {
  step: EditStep;
  stepIndex: number;
  stepCount: number;
  created: boolean;
}

export function editLabel({ step, stepIndex, stepCount, created }: EditLabelParts): string {
  if (created) return "Claude · writing a new file";
  const span = step.firstLine === step.lastLine ? `line ${String(step.firstLine)}` : `lines ${String(step.firstLine)}–${String(step.lastLine)}`;
  const position = `change ${String(stepIndex + 1)} of ${String(stepCount)}`;
  return `Claude · editing ${span} · ${position}`;
}
