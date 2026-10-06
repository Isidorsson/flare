import { describe, expect, test } from "bun:test";

import {
  cameraAfterFitRequest,
  cameraAfterFollowToggle,
  cameraAfterUserMove,
  cameraGoal,
  FIT_VIEW,
  FOLLOW_RATIO,
  INITIAL_CAMERA,
  stepCameraView,
} from "./camera-state";

const FRAME = 1000 / 60;

describe("camera preferences", () => {
  test("starts auto-fitting without following", () => {
    expect(INITIAL_CAMERA).toEqual({ autoFit: true, follow: false });
  });

  test("a user move frees the camera, and the same object comes back once it is already free", () => {
    const free = cameraAfterUserMove(INITIAL_CAMERA);
    expect(free).toEqual({ autoFit: false, follow: false });
    expect(cameraAfterUserMove(free)).toBe(free);
  });

  test("a user move also ends follow", () => {
    expect(cameraAfterUserMove({ autoFit: false, follow: true })).toEqual({ autoFit: false, follow: false });
  });

  test("fit re-enables auto-fit and ends follow", () => {
    expect(cameraAfterFitRequest()).toEqual({ autoFit: true, follow: false });
  });

  test("follow toggles on (releasing auto-fit) and off", () => {
    const following = cameraAfterFollowToggle(INITIAL_CAMERA);
    expect(following).toEqual({ autoFit: false, follow: true });
    expect(cameraAfterFollowToggle(following)).toEqual({ autoFit: false, follow: false });
  });
});

describe("cameraGoal", () => {
  const view = { x: 0.3, y: 0.7, ratio: 0.9 };

  test("auto-fit aims for the whole graph", () => {
    expect(cameraGoal({ autoFit: true, follow: false }, view, { x: 1, y: 1 })).toEqual(FIT_VIEW);
  });

  test("follow aims at the comet, zooming in to the follow ratio", () => {
    expect(cameraGoal({ autoFit: false, follow: true }, view, { x: 0.6, y: 0.4 })).toEqual({
      x: 0.6,
      y: 0.4,
      ratio: FOLLOW_RATIO,
    });
  });

  test("follow never zooms out from a closer view", () => {
    const close = { x: 0.3, y: 0.7, ratio: 0.1 };
    expect(cameraGoal({ autoFit: false, follow: true }, close, { x: 0.6, y: 0.4 })?.ratio).toBe(0.1);
  });

  test("a free camera, or follow without a comet, has no goal", () => {
    expect(cameraGoal({ autoFit: false, follow: false }, view, { x: 0.6, y: 0.4 })).toBeNull();
    expect(cameraGoal({ autoFit: false, follow: true }, view, null)).toBeNull();
  });
});

describe("stepCameraView", () => {
  test("eases 12% of the way per frame", () => {
    const { view, settled } = stepCameraView({ x: 0, y: 1, ratio: 2 }, { x: 1, y: 0, ratio: 1 }, FRAME, false);
    expect(view.x).toBeCloseTo(0.12, 9);
    expect(view.y).toBeCloseTo(0.88, 9);
    expect(view.ratio).toBeCloseTo(2 * Math.pow(0.5, 0.12), 9);
    expect(settled).toBe(false);
  });

  test("converges and reports settled on the goal", () => {
    let view = { x: 0, y: 0, ratio: 5 };
    let settled = false;
    for (let frame = 0; frame < 200 && !settled; frame += 1) {
      ({ view, settled } = stepCameraView(view, FIT_VIEW, FRAME, false));
    }
    expect(settled).toBe(true);
    expect(view).toEqual(FIT_VIEW);
  });

  test("snaps under reduced motion", () => {
    const { view, settled } = stepCameraView({ x: 0, y: 0, ratio: 5 }, FIT_VIEW, FRAME, true);
    expect(view).toEqual(FIT_VIEW);
    expect(settled).toBe(true);
  });
});
