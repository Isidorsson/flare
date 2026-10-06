import { frameFraction } from "./activity-math";
import type { Point } from "./placement";

export const CAMERA_EASE_PER_FRAME = 0.12;
export const FOLLOW_RATIO = 0.5;
const SETTLE_POSITION = 0.0005;
const SETTLE_RATIO = 0.002;

export interface CameraView {
  readonly x: number;
  readonly y: number;
  readonly ratio: number;
}

export interface CameraPrefs {
  readonly autoFit: boolean;
  readonly follow: boolean;
}

export const FIT_VIEW: CameraView = { x: 0.5, y: 0.5, ratio: 1 };
export const INITIAL_CAMERA: CameraPrefs = { autoFit: true, follow: false };

const FREE_CAMERA: CameraPrefs = { autoFit: false, follow: false };
const FITTED_CAMERA: CameraPrefs = { autoFit: true, follow: false };

/** Returns the same object when nothing changes so a drag does not notify subscribers on every frame. */
export function cameraAfterUserMove(prefs: CameraPrefs): CameraPrefs {
  return prefs.autoFit || prefs.follow ? FREE_CAMERA : prefs;
}

export function cameraAfterFitRequest(): CameraPrefs {
  return FITTED_CAMERA;
}

export function cameraAfterFollowToggle(prefs: CameraPrefs): CameraPrefs {
  return { autoFit: false, follow: !prefs.follow };
}

/** `cometPoint` is in the camera's own (framed graph) coordinates; follow holds still while the agent has no position. */
export function cameraGoal(prefs: CameraPrefs, current: CameraView, cometPoint: Point | null): CameraView | null {
  if (prefs.autoFit) return FIT_VIEW;
  if (!prefs.follow || cometPoint === null) return null;
  return { x: cometPoint.x, y: cometPoint.y, ratio: Math.min(current.ratio, FOLLOW_RATIO) };
}

export interface CameraStep {
  readonly view: CameraView;
  readonly settled: boolean;
}

export function stepCameraView(
  current: CameraView,
  goal: CameraView,
  dtMs: number,
  reducedMotion: boolean,
): CameraStep {
  const fraction = reducedMotion ? 1 : frameFraction(CAMERA_EASE_PER_FRAME, dtMs);
  const view: CameraView = {
    x: current.x + (goal.x - current.x) * fraction,
    y: current.y + (goal.y - current.y) * fraction,
    ratio: current.ratio * Math.pow(goal.ratio / current.ratio, fraction),
  };
  const settled =
    Math.abs(goal.x - view.x) < SETTLE_POSITION &&
    Math.abs(goal.y - view.y) < SETTLE_POSITION &&
    Math.abs(goal.ratio - view.ratio) < SETTLE_RATIO;
  return { view: settled ? goal : view, settled };
}
