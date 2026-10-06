import Sigma from "sigma";

import { HEAT_SETTLED_MS, isTwinkling, TWINKLE_MS } from "./activity-math";
import { readActivityPalette, type ActivityPalette } from "./activity-palette";
import type { ActivityState } from "./activity-state";
import { AgentOverlay } from "./agent-overlay";
import { nodeStyle, type AppearanceContext, type Focus } from "./appearance";
import { CameraController } from "./camera-controller";
import { noHoverDrawing } from "./canvas-draw";
import { edgeStyle, HIDE_EDGES_ON_MOVE_THRESHOLD, restingEdgeAlpha, showsArrows, type EdgeStyle } from "./edge-appearance";
import { browserFrameScheduler, createFrameLoop, type FrameLoop } from "./frame-loop";
import { diffSnapshots, isEmptyDiff } from "./graph-diff";
import { GlowLayer } from "./glow-layer";
import type { GraphIndex } from "./graph-index";
import { displayNode, readPositions, createCodeGraph, type CodeGraph, type EdgeAttrs, type NodeAttrs, type NodeDisplay } from "./graph-model";
import type { GraphState, GraphStore } from "./graph-store";
import { syncGraph } from "./graph-sync";
import type { GraphSnapshot } from "./graph-types";
import { LabelLayer } from "./label-layer";
import { browserScheduler, startLayout, type LayoutRun } from "./layout";
import { FALLBACK_VIEWPORT_PX, RELAX_ROUNDS, SETTLE_ROUNDS } from "./layout-params";
import { clock, prefersReducedMotion } from "./motion";
import { sizeScale } from "./node-scale";
import { readCssVariable, readPalette, type Palette } from "./palette";
import { AGENT_LAYER, createSceneLayers, GLOW_LAYER, HALO_LAYER, LABEL_LAYER, type SceneLayers } from "./scene-layers";

const NODE_REFRESH_WINDOW_MS = TWINKLE_MS + 500;
const MIN_CAMERA_RATIO = 0.03;
const MAX_CAMERA_RATIO = 30;
const STAGE_PADDING = 36;
const EMPTY_SCALE = sizeScale(0, 0);

export interface SceneOptions {
  container: HTMLElement;
  store: GraphStore;
  onNodeClick: (id: string) => void;
  onNodeOpen: (id: string) => void;
  onStageClick: () => void;
}

export class GraphScene {
  private readonly store: GraphStore;
  private readonly graph: CodeGraph = createCodeGraph();
  private readonly palette: Palette;
  private readonly activityColors: ActivityPalette;
  private readonly sigma: Sigma<NodeAttrs, EdgeAttrs>;
  private readonly container: HTMLElement;
  private readonly layers: SceneLayers;
  private readonly glow: GlowLayer;
  private readonly labels: LabelLayer;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private snapshot: GraphSnapshot | null = null;
  private index: GraphIndex | null = null;
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
      scene.attach(options);
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
      defaultEdgeType: "line",
      defaultNodeColor: this.palette.dim,
      defaultEdgeColor: this.palette.edge,
      renderEdgeLabels: false,
      renderLabels: false,
      zIndex: true,
      stagePadding: STAGE_PADDING,
      minCameraRatio: MIN_CAMERA_RATIO,
      maxCameraRatio: MAX_CAMERA_RATIO,
      defaultDrawNodeHover: noHoverDrawing,
      nodeReducer: (node, data) => this.reduceNode(node, data),
      edgeReducer: (edge) => this.reduceEdge(edge),
    });
    this.layers = createSceneLayers(this.sigma);
    this.glow = new GlowLayer(this.sigma);
    this.labels = new LabelLayer({
      sigma: this.sigma,
      graph: this.graph,
      store: this.store,
      palette: this.palette,
      colors: this.activityColors,
      layer: () => this.layers.context(LABEL_LAYER),
      now: clock,
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

  private attach(options: SceneOptions): void {
    this.startAgentLayers();
    this.bindEvents(options);
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

  private startAgentLayers(): void {
    const { sigma, graph, store, palette } = this;
    this.overlay = new AgentOverlay({
      sigma,
      graph,
      store,
      palette,
      colors: this.activityColors,
      now: clock,
      layers: {
        halos: () => this.layers.context(HALO_LAYER),
        agent: () => this.layers.context(AGENT_LAYER),
      },
    });
    this.camera = new CameraController(sigma, store);
    this.loop = createFrameLoop({
      scheduler: browserFrameScheduler,
      step: this.stepFrame,
      heartbeat: this.beat,
    });
  }

  private bindEvents(options: SceneOptions): void {
    this.sigma.on("clickNode", ({ node }) => {
      options.onNodeClick(node);
    });
    this.sigma.on("doubleClickNode", (event) => {
      event.preventSigmaDefault();
      options.onNodeOpen(event.node);
    });
    this.sigma.on("clickStage", () => {
      options.onStageClick();
    });
    this.sigma.on("enterNode", ({ node }) => {
      this.setFocus(node);
    });
    this.sigma.on("leaveNode", () => {
      this.setFocus(null);
    });
    this.sigma.on("afterRender", () => {
      this.drawOverlays(prefersReducedMotion());
    });
  }

  private drawOverlays(reducedMotion: boolean): void {
    const { colorBy } = this.store.getState();
    this.glow.draw(this.layers.context(GLOW_LAYER), { colorBy, palette: this.palette });
    this.overlay?.draw(reducedMotion);
    this.labels.draw();
  }

  private buildAppearance(state: GraphState): AppearanceContext {
    const edges = this.snapshot?.edges.length ?? 0;
    return {
      palette: this.palette,
      colorBy: state.colorBy,
      level: state.level,
      blast: state.blast,
      activityColors: this.activityColors,
      activity: state.activity,
      now: clock(),
      reducedMotion: prefersReducedMotion(),
      focus: this.focus,
      selected: state.selected,
      scale: this.index?.scale ?? EMPTY_SCALE,
      edgeAlpha: restingEdgeAlpha(edges),
      arrows: showsArrows(edges),
    };
  }

  private reduceNode(id: string, data: NodeAttrs): NodeDisplay {
    const style = nodeStyle({ id, ...data }, this.appearance);
    return displayNode(data, style);
  }

  private reduceEdge(edge: string): EdgeStyle {
    const { graph } = this;
    const source = graph.source(edge);
    const target = graph.target(edge);
    const ends = [graph.getNodeAttributes(source), graph.getNodeAttributes(target)];
    return edgeStyle(
      {
        kind: graph.getEdgeAttribute(edge, "kind"),
        source,
        target,
        betweenHubs: ends.every((end) => end.kind === "folder" && end.hub === end.folder),
      },
      this.appearance,
    );
  }

  private onStateChange(state: GraphState, previous: GraphState): void {
    if (state.snapshot !== previous.snapshot) this.applySnapshot(state.snapshot);
    const appearanceChanged =
      state.colorBy !== previous.colorBy ||
      state.mode !== previous.mode ||
      state.blast !== previous.blast ||
      state.level !== previous.level ||
      state.selected !== previous.selected;
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
    this.labels.setFocus(this.focus);
    this.container.style.cursor = node === null ? "" : "pointer";
    this.refreshView();
  }

  private applySnapshot(next: GraphSnapshot | null): void {
    if (next === null) {
      this.layoutRun?.cancel();
      this.graph.clear();
      this.snapshot = null;
      this.index = null;
      this.labels.setIndex(null);
      this.glow.setIndex(null);
      this.refreshView();
      return;
    }
    const diff = diffSnapshots(this.snapshot, next);
    if (isEmptyDiff(diff) && this.snapshot !== null) return;
    const wasEmpty = this.graph.order === 0;
    const stored = this.store.getState().positions;
    this.index = syncGraph(this.graph, next, diff, stored);
    this.snapshot = next;
    this.labels.setIndex(this.index);
    this.glow.setIndex(this.index);
    this.glow.refit(this.graph, this.index);
    this.sigma.setSetting("hideEdgesOnMove", next.edges.length > HIDE_EDGES_ON_MOVE_THRESHOLD);
    this.refreshView();
    const placedAll = this.graph.nodes().every((id) => stored.has(id));
    if (!(wasEmpty && placedAll)) this.runLayout(wasEmpty);
  }

  private runLayout(full: boolean): void {
    this.layoutRun?.cancel();
    this.layoutSettled = false;
    const working = this.graph.copy();
    const reducedMotion = prefersReducedMotion();
    const side = Math.min(this.container.clientWidth, this.container.clientHeight);
    this.layoutRun = startLayout(working, {
      rounds: full ? RELAX_ROUNDS : SETTLE_ROUNDS,
      animate: !reducedMotion,
      viewportPx: side > 0 ? side : FALLBACK_VIEWPORT_PX,
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
    this.glow.refit(this.graph, this.index);
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
    if (!refreshed) this.drawOverlays(reducedMotion);
    return overlayBusy || cameraBusy || this.hasFlowingSelection(reducedMotion) || (!reducedMotion && hot);
  };

  private hasFlowingSelection(reducedMotion: boolean): boolean {
    const { selected, blast } = this.store.getState();
    return !reducedMotion && (selected !== null || blast !== null);
  }

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
