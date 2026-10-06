import Sigma from "sigma";

import {
  edgeStyle,
  nodeStyle,
  type AppearanceContext,
  type EdgeStyle,
  type Focus,
} from "./appearance";
import { HEAT_SETTLED_MS, isTwinkling, TWINKLE_MS } from "./activity-math";
import { readActivityPalette, type ActivityPalette } from "./activity-palette";
import type { ActivityState } from "./activity-state";
import { AgentOverlay } from "./agent-overlay";
import { CameraController } from "./camera-controller";
import { createHoverDrawer } from "./canvas-draw";
import { browserFrameScheduler, createFrameLoop, type FrameLoop } from "./frame-loop";
import { diffSnapshots, isEmptyDiff } from "./graph-diff";
import {
  applyDiff,
  createCodeGraph,
  displayNode,
  readPositions,
  type CodeGraph,
  type EdgeAttrs,
  type NodeAttrs,
  type NodeDisplay,
} from "./graph-model";
import type { GraphState, GraphStore } from "./graph-store";
import type { GraphSnapshot } from "./graph-types";
import { browserScheduler, layoutIterations, startLayout, type LayoutRun } from "./layout";
import { clock, prefersReducedMotion } from "./motion";
import { readCssVariable, readPalette, type Palette } from "./palette";

const HALO_LAYER = "halos";
const AGENT_LAYER = "agent";
const NODES_LAYER = "nodes";
const SETTLE_ITERATIONS = 80;
const HIDE_EDGES_ON_MOVE_THRESHOLD = 4000;
const NODE_REFRESH_WINDOW_MS = TWINKLE_MS + 500;
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
  private readonly activityColors: ActivityPalette;
  private readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private readonly container: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private snapshot: GraphSnapshot | null = null;
  private appearance: AppearanceContext;
  private focus: Focus | null = null;
  private layoutRun: LayoutRun | null = null;
  private layoutSettled = true;
  private overlay: AgentOverlay | null = null;
  private camera: CameraController | null = null;
  private loop: FrameLoop | null = null;
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
    this.activityColors = readActivityPalette(readCssVariable);
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
    this.loop?.dispose();
    this.camera?.dispose();
    this.persistPositions();
    this.container.style.cursor = "";
    this.sigma.kill();
  }

  private attach(onNodeClick: (id: string) => void): void {
    this.startAgentLayers();
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
    this.loop?.wake();
  }

  private createLayers(): void {
    this.sigma.createCanvasContext(HALO_LAYER, { style: { pointerEvents: "none" } });
    this.sigma.createCanvasContext(AGENT_LAYER, { style: { pointerEvents: "none" } });
    const canvases = this.sigma.getCanvases();
    const nodes = canvases[NODES_LAYER];
    const halos = canvases[HALO_LAYER];
    if (nodes === undefined || halos === undefined || canvases[AGENT_LAYER] === undefined) {
      throw new Error("sigma did not create the expected render layers");
    }
    nodes.before(halos);
  }

  private layerContext(layer: string): CanvasRenderingContext2D | null {
    return this.sigma.getCanvases()[layer]?.getContext("2d") ?? null;
  }

  private startAgentLayers(): void {
    const { sigma, graph, store, palette } = this;
    this.createLayers();
    this.overlay = new AgentOverlay({
      sigma,
      graph,
      store,
      palette,
      colors: this.activityColors,
      now: clock,
      layers: {
        halos: () => this.layerContext(HALO_LAYER),
        agent: () => this.layerContext(AGENT_LAYER),
      },
    });
    this.camera = new CameraController(sigma, store);
    this.loop = createFrameLoop({
      scheduler: browserFrameScheduler,
      step: this.stepFrame,
      heartbeat: this.beat,
    });
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
      this.overlay?.draw(prefersReducedMotion());
    });
  }

  private buildAppearance(state: GraphState): AppearanceContext {
    return {
      palette: this.palette,
      colorBy: state.colorBy,
      blast: state.blast,
      activityColors: this.activityColors,
      activity: state.activity,
      now: clock(),
      reducedMotion: prefersReducedMotion(),
      focus: this.focus,
    };
  }

  private reduceNode(id: string, data: NodeAttrs): NodeDisplay {
    const style = nodeStyle(
      {
        id,
        label: data.label,
        language: data.language,
        dirKey: data.dirKey,
        inDegree: this.graph.inDegree(id),
      },
      this.appearance,
    );
    return displayNode(data, style);
  }

  private reduceEdge(edge: string): EdgeStyle {
    return edgeStyle(this.graph.source(edge), this.graph.target(edge), this.appearance);
  }

  private onStateChange(state: GraphState, previous: GraphState): void {
    if (state.snapshot !== previous.snapshot) this.applySnapshot(state.snapshot);
    const appearanceChanged =
      state.colorBy !== previous.colorBy || state.mode !== previous.mode || state.blast !== previous.blast;
    if (appearanceChanged) this.refreshView();
    if (state.activity !== previous.activity) this.onActivityChange(state.activity, previous.activity);
    if (state.camera !== previous.camera) this.loop?.wake();
  }

  private onActivityChange(next: ActivityState, previous: ActivityState): void {
    const { lastEvent } = next;
    if (lastEvent !== null && lastEvent !== previous.lastEvent) {
      this.overlay?.handleEvent(lastEvent, prefersReducedMotion());
    }
    this.loop?.wake();
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
    if (!(wasEmpty && placedAll)) this.runLayout(wasEmpty);
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
        this.loop?.wake();
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

  private readonly stepFrame = (deltaMs: number): boolean => {
    const { overlay, camera } = this;
    if (overlay === null || camera === null || this.disposed) return false;
    const reducedMotion = prefersReducedMotion();
    this.appearance = this.buildAppearance(this.store.getState());
    const overlayBusy = overlay.step(deltaMs, reducedMotion);
    const cameraBusy = camera.step(deltaMs, overlay.cometCameraPoint(), reducedMotion);
    const { refreshable, hot } = this.classifyNodes();
    const refreshed = this.refreshNodes(refreshable);
    if (!refreshed) overlay.draw(reducedMotion);
    return overlayBusy || cameraBusy || (!reducedMotion && hot);
  };

  private readonly beat = (): boolean => {
    const { nodes } = this.store.getState().activity;
    const now = clock();
    this.appearance = this.buildAppearance(this.store.getState());
    this.refreshNodes([...nodes.keys()]);
    return [...nodes.values()].some((activity) => now - activity.lastTouchedAt < HEAT_SETTLED_MS);
  };

  private classifyNodes(): { refreshable: string[]; hot: boolean } {
    const now = clock();
    const refreshable: string[] = [];
    let hot = false;
    for (const [id, activity] of this.store.getState().activity.nodes) {
      const elapsed = now - activity.lastTouchedAt;
      if (elapsed >= NODE_REFRESH_WINDOW_MS || !this.graph.hasNode(id)) continue;
      refreshable.push(id);
      hot ||= isTwinkling(elapsed);
    }
    return { refreshable, hot };
  }

  private refreshNodes(ids: readonly string[]): boolean {
    const nodes = ids.filter((id) => this.graph.hasNode(id));
    if (nodes.length === 0) return false;
    this.sigma.refresh({ partialGraph: { nodes, edges: [] }, skipIndexation: true });
    return true;
  }
}
