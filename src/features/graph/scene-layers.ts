import type Sigma from "sigma";

import type { EdgeAttrs, NodeAttrs } from "./graph-model";

export const GLOW_LAYER = "graph-glows";
export const HALO_LAYER = "halos";
export const LABEL_LAYER = "graph-labels";
export const AGENT_LAYER = "agent";

export interface SceneLayers {
  context: (layer: string) => CanvasRenderingContext2D | null;
}

function canvasOf(sigma: Sigma<NodeAttrs, EdgeAttrs>, id: string): HTMLCanvasElement {
  const canvas = sigma.getCanvases()[id];
  if (canvas === undefined) throw new Error(`sigma did not create the "${id}" render layer`);
  return canvas;
}

/**
 * Adds the graph's own canvases and stacks them: glows under the edges, then edges, nodes, halos, labels and the agent.
 * Sigma's own mouse layer stays on top so it keeps receiving the pointer.
 */
export function createSceneLayers(sigma: Sigma<NodeAttrs, EdgeAttrs>): SceneLayers {
  for (const layer of [GLOW_LAYER, HALO_LAYER, LABEL_LAYER, AGENT_LAYER]) {
    sigma.createCanvasContext(layer, { style: { pointerEvents: "none" } });
  }
  canvasOf(sigma, "edges").before(canvasOf(sigma, GLOW_LAYER));
  canvasOf(sigma, "nodes").after(canvasOf(sigma, HALO_LAYER));
  canvasOf(sigma, HALO_LAYER).after(canvasOf(sigma, LABEL_LAYER));
  canvasOf(sigma, LABEL_LAYER).after(canvasOf(sigma, AGENT_LAYER));
  sigma.resize(true);
  return { context: (layer) => canvasOf(sigma, layer).getContext("2d") };
}
