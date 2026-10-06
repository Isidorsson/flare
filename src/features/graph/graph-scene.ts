import Sigma from "sigma";

import {
  edgeStyle,
  nodeStyle,
  type AppearanceContext,
  type EdgeStyle,
  type Focus,
  type NodeStyle,
} from "./appearance";
import { createHoverDrawer, drawHalo } from "./canvas-draw";
import { diffSnapshots, isEmptyDiff } from "./graph-diff";
import {
  applyDiff,
  createCodeGraph,
  readPositions,
  type CodeGraph,
  type EdgeAttrs,
  type NodeAttrs,
} from "./graph-model";
import type { GraphState, GraphStore } from "./graph-store";
import type { GraphSnapshot } from "./graph-types";
import { browserScheduler, layoutIterations, startLayout, type LayoutRun } from "./layout";
import { readCssVariable, readPalette, type Palette } from "./palette";
import { prefersReducedMotion, pulseClock, pulseIntensity } from "./pulse";

const HALO_LAYER = "pulses";
const NODES_LAYER = "nodes";
const SETTLE_ITERATIONS = 80;
const HIDE_EDGES_ON_MOVE_THRESHOLD = 4000;
const CAMERA_RESET_MS = 400;
const LABEL_SIZE = 11;
const MIN_CAMERA_RATIO = 0.03;
const MAX_CAMERA_RATIO = 30;

export interface SceneOptions {
  container: HTMLElement;
  store: GraphStore;
  onNodeClick: (id: string) => void;
}

export class GraphScene {
  private readonly store: GraphStore;
  private readonly graph: CodeGraph = createCodeGraph();
  private readonly palette: Palette;
  private readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private readonly container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private snapshot: GraphSnapshot | null = null;
  private appearance: AppearanceContext;
  private focus: Focus | null = null;
  private layoutRun: LayoutRun | null = null;
  private layoutSettled = true;
  private pulseFrame: number | null = null;
  private disposed = false;

  static start(options: SceneOptions): GraphScene {
    const scene = new GraphScene(options);
    try {
      scene.attach(options.onNodeClick);
    } catch (error) {
      scene.dispose();
      throw error;
    }
    return scene;
  }

  private constructor(options: SceneOptions) {
    this.store = options.store;
    this.container = options.container;
    this.palette = readPalette(readCssVariable);
    this.appearance = this.buildAppearance(this.store.getState());
    this.sigma = new Sigma<NodeAttrs, EdgeAttrs>(this.graph, options.container, {
      allowInvalidContainer: true,
      defaultEdgeType: "arrow",
      defaultNodeColor: this.palette.dim,
      defaultEdgeColor: this.palette.edge,
      renderEdgeLabels: false,
      zIndex: true,
      labelFont: this.palette.fontFamily,
      labelSize: LABEL_SIZE,
      labelWeight: "500",
      labelColor: { color: this.palette.label },
      labelDensity: 0.7,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 5,
      minCameraRatio: MIN_CAMERA_RATIO,
      maxCameraRatio: MAX_CAMERA_RATIO,
      defaultDrawNodeHover: createHoverDrawer(this.palette),
      nodeReducer: (node, data) => this.reduceNode(node, data),
      edgeReducer: (edge) => this.reduceEdge(edge),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.layoutRun?.cancel();
    if (this.pulseFrame !== null) cancelAnimationFrame(this.pulseFrame);
    this.persistPositions();
    this.container.style.cursor = "";
    this.sigma.kill();
  }

  private attach(onNodeClick: (id: string) => void): void {
    this.createHaloLayer();
    this.bindEvents(onNodeClick);
    const observer = new ResizeObserver(() => {
      this.sigma.resize();
      this.sigma.scheduleRender();
    });
    observer.observe(this.container);
    this.resizeObserver = observer;
    this.unsubscribe = this.store.subscribe((state, previous) => {
      this.onStateChange(state, previous);
    });
    const initial = this.store.getState().snapshot;
    if (initial !== null) this.applySnapshot(initial);
    this.ensurePulseLoop();
  }

  private createHaloLayer(): void {
    this.sigma.createCanvasContext(HALO_LAYER, { style: { pointerEvents: "none" } });
    const canvases = this.sigma.getCanvases();
    const nodes = canvases[NODES_LAYER];
    const halo = canvases[HALO_LAYER];
    if (nodes === undefined || halo === undefined) {
      throw new Error("sigma did not create the expected render layers");
    }
    nodes.before(halo);
  }

  private bindEvents(onNodeClick: (id: string) => void): void {
    this.sigma.on("clickNode", ({ node }) => {
      onNodeClick(node);
    });
    this.sigma.on("enterNode", ({ node }) => {
      this.setFocus(node);
    });
    this.sigma.on("leaveNode", () => {
      this.setFocus(null);
    });
    this.sigma.on("afterRender", () => {
      this.drawHalos();
    });
  }

  private buildAppearance(state: GraphState): AppearanceContext {
    return {
      palette: this.palette,
      colorBy: state.colorBy,
      blast: state.blast,
      pulses: state.pulses,
      now: pulseClock(),
      reducedMotion: prefersReducedMotion(),
      focus: this.focus,
    };
  }

  private reduceNode(id: string, data: NodeAttrs): NodeStyle {
    return nodeStyle(
      {
        id,
        label: data.label,
        language: data.language,
        dirKey: data.dirKey,
        inDegree: this.graph.inDegree(id),
      },
      this.appearance,
    );
  }

  private reduceEdge(edge: string): EdgeStyle {
    return edgeStyle(this.graph.source(edge), this.graph.target(edge), this.appearance);
  }

  private onStateChange(state: GraphState, previous: GraphState): void {
    if (state.snapshot !== previous.snapshot) this.applySnapshot(state.snapshot);
    const appearanceChanged =
      state.colorBy !== previous.colorBy || state.mode !== previous.mode || state.blast !== previous.blast;
    if (appearanceChanged) this.refreshView();
    if (state.pulses !== previous.pulses) this.ensurePulseLoop();
  }

  private refreshView(): void {
    this.appearance = this.buildAppearance(this.store.getState());
    this.sigma.refresh();
  }

  private setFocus(node: string | null): void {
    this.focus = node === null ? null : { node, neighbours: new Set(this.graph.neighbors(node)) };
    this.container.style.cursor = node === null ? "" : "pointer";
    this.refreshView();
  }

  private applySnapshot(next: GraphSnapshot | null): void {
    if (next === null) {
      this.layoutRun?.cancel();
      this.graph.clear();
      this.snapshot = null;
      this.refreshView();
      return;
    }
    const stored = this.store.getState().positions;
    const wasEmpty = this.graph.order === 0;
    const diff = diffSnapshots(this.snapshot, next);
    applyDiff(this.graph, diff, stored);
    this.snapshot = next;
    this.sigma.setSetting("hideEdgesOnMove", next.edges.length > HIDE_EDGES_ON_MOVE_THRESHOLD);
    this.refreshView();
    if (isEmptyDiff(diff)) return;
    const placedAll = diff.addedNodes.every((node) => stored.has(node.id));
    if (wasEmpty && placedAll) {
      this.fitCamera();
    } else {
      this.runLayout(wasEmpty);
    }
  }

  private runLayout(full: boolean): void {
    this.layoutRun?.cancel();
    this.layoutSettled = false;
    const working = this.graph.copy();
    const reducedMotion = prefersReducedMotion();
    const maxIterations = layoutIterations(working.order);
    this.layoutRun = startLayout(working, {
      iterations: full ? maxIterations : Math.min(maxIterations, SETTLE_ITERATIONS),
      animate: !reducedMotion,
      scheduler: browserScheduler,
      onFrame: () => {
        this.writeBack(working);
      },
      onDone: () => {
        this.writeBack(working);
        this.layoutSettled = true;
        this.persistPositions();
        if (full) this.fitCamera();
      },
    });
  }

  private writeBack(working: CodeGraph): void {
    this.graph.updateEachNodeAttributes((id, attributes) => {
      if (!working.hasNode(id)) return attributes;
      const { x, y } = working.getNodeAttributes(id);
      return { ...attributes, x, y };
    });
  }

  private persistPositions(): void {
    if (this.layoutSettled && this.graph.order > 0) {
      this.store.getState().savePositions(readPositions(this.graph));
    }
  }

  private fitCamera(): void {
    const camera = this.sigma.getCamera();
    if (prefersReducedMotion()) {
      camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      return;
    }
    camera.animatedReset({ duration: CAMERA_RESET_MS }).catch((error: unknown) => {
      console.error("flare: camera reset failed", error);
    });
  }

  private ensurePulseLoop(): void {
    if (this.pulseFrame !== null || this.disposed) return;
    if (this.store.getState().pulses.size === 0) return;
    this.pulseFrame = requestAnimationFrame(this.tickPulses);
  }

  private readonly tickPulses = (): void => {
    this.pulseFrame = null;
    if (this.disposed) return;
    const state = this.store.getState();
    const touched = [...state.pulses.keys()].filter((id) => this.graph.hasNode(id));
    state.expirePulses(pulseClock());
    this.appearance = this.buildAppearance(this.store.getState());
    this.sigma.refresh({ partialGraph: { nodes: touched, edges: [] }, skipIndexation: true });
    this.ensurePulseLoop();
  };

  private drawHalos(): void {
    const context = this.sigma.getCanvases()[HALO_LAYER]?.getContext("2d");
    if (context === null || context === undefined) return;
    const { width, height } = this.sigma.getDimensions();
    context.clearRect(0, 0, width, height);
    if (this.appearance.reducedMotion) return;
    const now = pulseClock();
    for (const [id, pulse] of this.appearance.pulses) {
      const intensity = pulseIntensity(pulse, now, false);
      const display = this.graph.hasNode(id) ? this.sigma.getNodeDisplayData(id) : undefined;
      if (intensity <= 0 || display === undefined) continue;
      const point = this.sigma.graphToViewport(this.graph.getNodeAttributes(id));
      drawHalo(context, {
        ...point,
        radius: this.sigma.scaleSize(display.size),
        color: this.palette.pulse[pulse.kind],
        intensity,
      });
    }
  }
}
