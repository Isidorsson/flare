import type { CodeGraph } from "./graph-model";
import {
  FINAL_SEPARATION_PASSES,
  RELAX_PULL,
  SEPARATION_GAP_PX,
  SEPARATION_PASSES_PER_ROUND,
  unitsPerPixel,
} from "./layout-params";
import { buildRelaxModel, relaxPull, type RelaxModel } from "./relax";
import { createSeparator, type Bodies, type Separator } from "./separation";

const FRAME_BUDGET_MS = 10;
const MIN_NODES_TO_LAYOUT = 2;
const FINAL_STEP = 6;

export interface LayoutScheduler {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
}

export const browserScheduler: LayoutScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  now: () => performance.now(),
};

export interface LayoutOptions {
  /** How many pull-and-push rounds to run before the final untangling. */
  rounds: number;
  animate: boolean;
  /** The shorter side of the view in pixels, used to turn node sizes into layout units. */
  viewportPx: number;
  onFrame: () => void;
  onDone: () => void;
  scheduler: LayoutScheduler;
}

export interface LayoutRun {
  cancel: () => void;
}

interface Placement {
  readonly ids: readonly string[];
  readonly bodies: Bodies;
}

function isShown(graph: CodeGraph, id: string): boolean {
  const attributes = graph.getNodeAttributes(id);
  return attributes.kind === "file" || attributes.hub === attributes.folder;
}

function extentOf(graph: CodeGraph): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((_, { x, y }) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  return Math.max(maxX - minX, maxY - minY);
}

/** Node sizes are pixels at fit zoom; the layout lives in its own units, so sizes are converted by the fitted scale. */
export function placementBodies(graph: CodeGraph, viewportPx: number): Placement {
  const perPixel = unitsPerPixel(extentOf(graph), viewportPx);
  const ids = graph.nodes();
  const xs = new Float64Array(ids.length);
  const ys = new Float64Array(ids.length);
  const radii = new Float64Array(ids.length);
  ids.forEach((id, index) => {
    const attributes = graph.getNodeAttributes(id);
    xs[index] = attributes.x;
    ys[index] = attributes.y;
    radii[index] = isShown(graph, id) ? (attributes.size + SEPARATION_GAP_PX / 2) * perPixel : 0;
  });
  return { ids, bodies: { xs, ys, radii } };
}

function writeBodies(graph: CodeGraph, placement: Placement): void {
  placement.ids.forEach((id, index) => {
    graph.setNodeAttribute(id, "x", placement.bodies.xs[index] ?? 0);
    graph.setNodeAttribute(id, "y", placement.bodies.ys[index] ?? 0);
  });
}

/**
 * Starts from the folder-packed seeds. Each round pulls files towards what they import (without leaving their folder)
 * and pushes touching nodes apart; a last run of pushing leaves nothing overlapping.
 */
class LayoutJob {
  private readonly graph: CodeGraph;
  private readonly options: LayoutOptions;
  private readonly placement: Placement;
  private readonly model: RelaxModel;
  private readonly separator: Separator;
  private round = 0;
  private finalPasses = 0;
  private handle: number | null = null;
  private cancelled = false;

  constructor(graph: CodeGraph, options: LayoutOptions) {
    this.graph = graph;
    this.options = options;
    this.placement = placementBodies(graph, options.viewportPx);
    const { ids, bodies } = this.placement;
    this.model = buildRelaxModel(graph, ids, bodies.xs, bodies.ys);
    this.separator = createSeparator(bodies, 0);
  }

  start(): LayoutRun {
    this.handle = this.options.scheduler.requestFrame(this.tick);
    return { cancel: () => this.cancel() };
  }

  private cancel(): void {
    this.cancelled = true;
    if (this.handle !== null) this.options.scheduler.cancelFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (this.cancelled) return;
    const more = this.round < this.options.rounds ? this.advanceRounds() : this.advanceFinal();
    writeBodies(this.graph, this.placement);
    if (this.options.animate) this.options.onFrame();
    if (more) this.handle = this.options.scheduler.requestFrame(this.tick);
    else this.options.onDone();
  };

  private advanceRounds(): boolean {
    const { scheduler, rounds } = this.options;
    const frameStart = scheduler.now();
    do {
      relaxPull(this.model, RELAX_PULL);
      this.separator.step(SEPARATION_PASSES_PER_ROUND);
      this.round += 1;
    } while (this.round < rounds && scheduler.now() - frameStart < FRAME_BUDGET_MS);
    return true;
  }

  /** Returns whether more untangling is still needed. */
  private advanceFinal(): boolean {
    const { scheduler } = this.options;
    const frameStart = scheduler.now();
    let overlap: number;
    do {
      overlap = this.separator.step(FINAL_STEP);
      this.finalPasses += FINAL_STEP;
    } while (overlap > 0 && this.finalPasses < FINAL_SEPARATION_PASSES && scheduler.now() - frameStart < FRAME_BUDGET_MS);
    return overlap > 0 && this.finalPasses < FINAL_SEPARATION_PASSES;
  }
}

export function startLayout(graph: CodeGraph, options: LayoutOptions): LayoutRun {
  if (graph.order < MIN_NODES_TO_LAYOUT || options.rounds <= 0) {
    options.onDone();
    return { cancel: () => undefined };
  }
  return new LayoutJob(graph, options).start();
}
