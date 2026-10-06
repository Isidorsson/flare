import type Sigma from "sigma";

import { cameraGoal, stepCameraView, type CameraView } from "./camera-state";
import type { EdgeAttrs, NodeAttrs } from "./graph-model";
import type { GraphStore } from "./graph-store";
import type { Point } from "./placement";

export class CameraController {
  private readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private readonly store: GraphStore;
  private applying = false;

  constructor(sigma: Sigma<NodeAttrs, EdgeAttrs>, store: GraphStore) {
    this.sigma = sigma;
    this.store = store;
    sigma.getCamera().on("updated", this.onCameraUpdated);
  }

  dispose(): void {
    this.sigma.getCamera().off("updated", this.onCameraUpdated);
  }

  /** Eases towards the fit view or the comet; returns whether another frame is needed. */
  step(dtMs: number, cometPoint: Point | null, reducedMotion: boolean): boolean {
    const camera = this.sigma.getCamera();
    const { x, y, ratio } = camera.getState();
    const current: CameraView = { x, y, ratio };
    const goal = cameraGoal(this.store.getState().camera, current, cometPoint);
    if (goal === null) return false;
    const { view, settled } = stepCameraView(current, goal, dtMs, reducedMotion);
    this.applying = true;
    try {
      camera.setState({ ...view, angle: 0 });
    } finally {
      this.applying = false;
    }
    return !settled;
  }

  private readonly onCameraUpdated = (): void => {
    if (!this.applying) this.store.getState().moveCameraByUser();
  };
}
