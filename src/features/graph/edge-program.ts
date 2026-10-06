import type { Attributes } from "graphology-types";
import { EdgeRectangleProgram, type ProgramInfo } from "sigma/rendering";
import type { RenderParams } from "sigma/types";

import { screenSpaceParams } from "./edge-appearance";

/** Sigma's rectangle edge, drawn at its size in screen pixels whatever the zoom. */
export class ScreenWidthLineProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends EdgeRectangleProgram<N, E, G> {
  override setUniforms(params: RenderParams, program: ProgramInfo): void {
    super.setUniforms(screenSpaceParams(params), program);
  }
}
