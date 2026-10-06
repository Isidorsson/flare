import { isTwinkling, TWINKLE_MS, twinkleFactor } from "./activity-math";
import { activityColor, type ActivityPalette } from "./activity-palette";
import {
  agentLabel,
  agentTone,
  isChangedThisTurn,
  type ActivityEvent,
  type ActivityState,
  type FinishActivity,
  type TouchActivity,
} from "./activity-state";
import { arcColor, arcLinks, arcOrigin, arcShape, ARC_FLOW_PX_PER_MS } from "./arcs";
import { drawHalo, type Pen } from "./canvas-draw";
import { isCometAnimating, placePill, stepComet, trailSegments, type CometState } from "./comet";
import { withAlpha } from "./color-math";
import {
  FINISH_RING,
  isEffectActive,
  particleProgress,
  pruneEffects,
  ringFrame,
  routeMove,
  TOUCH_RING,
  type Effect,
  type ParticleEffect,
  type RingEffect,
} from "./effects";
import type { CodeGraph } from "./graph-model";
import type { GraphStore } from "./graph-store";
import {
  drawArc,
  drawChangedRing,
  drawCometHead,
  drawParticle,
  drawPathSegment,
  drawPill,
  drawRing,
  drawSelectionRing,
  drawTrail,
  measurePill,
} from "./overlay-draw";
import type { Palette } from "./palette";
import type { Point } from "./placement";

const AGENT_NAME = "Claude";
const EXPLORE_NAME = "Explore";
const PATH_PEAK_ALPHA = 0.55;
const PATH_FLOW_PX_PER_MS = 0.02;
const COMET_PULSE_PERIOD_MS = 900;
const PILL_BACKGROUND_ALPHA = 0.96;
const HALO_REDUCED_INTENSITY = 0.6;

export interface OverlaySigma {
  getDimensions: () => { width: number; height: number };
  graphToViewport: (point: Point) => Point;
  viewportToFramedGraph: (point: Point) => Point;
  scaleSize: (size?: number) => number;
  getNodeDisplayData: (id: string) => { size: number } | undefined;
}

export interface OverlayDeps {
  sigma: OverlaySigma;
  graph: CodeGraph;
  store: GraphStore;
  palette: Palette;
  colors: ActivityPalette;
  now: () => number;
  layers: { halos: () => Pen | null; agent: () => Pen | null };
}

function isBusy(state: ActivityState): boolean {
  return state.status === "working" || state.status === "thinking";
}

export class AgentOverlay {
  private readonly deps: OverlayDeps;
  private comet: CometState | null = null;
  private targetId: string | null;
  private effects: readonly Effect[] = [];

  constructor(deps: OverlayDeps) {
    this.deps = deps;
    this.targetId = deps.store.getState().activity.lastNodeId;
  }

  handleEvent(event: ActivityEvent, reducedMotion: boolean): void {
    if (event.type === "finish") this.handleFinish(event, reducedMotion);
    else this.handleTouch(event, reducedMotion);
  }

  step(dtMs: number, reducedMotion: boolean): boolean {
    this.effects = pruneEffects(this.effects, this.deps.now());
    const target = this.targetPoint();
    this.comet = stepComet(this.comet, target, dtMs, reducedMotion);
    if (this.effects.length > 0 || isCometAnimating(this.comet, target)) return true;
    return !reducedMotion && isBusy(this.deps.store.getState().activity);
  }

  /** The comet in the camera's own coordinates, for follow mode. */
  cometCameraPoint(): Point | null {
    if (this.comet === null) return null;
    const { sigma } = this.deps;
    return sigma.viewportToFramedGraph(sigma.graphToViewport(this.comet.position));
  }

  effectsSnapshot(): readonly Effect[] {
    return this.effects;
  }

  draw(reducedMotion: boolean): void {
    const now = this.deps.now();
    this.drawHalos(now, reducedMotion);
    this.drawAgentLayer(now, reducedMotion);
  }

  private handleTouch(event: TouchActivity, reducedMotion: boolean): void {
    const { graph, colors } = this.deps;
    if (event.nodeId === null || !graph.hasNode(event.nodeId)) return;
    if (reducedMotion) {
      if (event.movesComet) this.targetId = event.nodeId;
      return;
    }
    const color = activityColor(colors, event.kind);
    this.addEffect({ type: "ring", nodeId: event.nodeId, color, spec: TOUCH_RING, startedAt: event.at });
    if (!event.movesComet) return;
    this.fireAlongEdge(event, color);
    this.targetId = event.nodeId;
  }

  private fireAlongEdge(event: TouchActivity, color: string): void {
    const { graph } = this.deps;
    const connected = (source: string, target: string) =>
      graph.hasNode(source) && graph.hasNode(target) && graph.hasDirectedEdge(source, target);
    const route = routeMove(connected, event.from, event.nodeId);
    if (route.kind === "direct") return;
    this.addEffect({ type: "particle", fromId: route.from, toId: route.to, color, startedAt: event.at });
  }

  private handleFinish(event: FinishActivity, reducedMotion: boolean): void {
    const { graph, colors } = this.deps;
    if (reducedMotion || event.nodeId === null || !graph.hasNode(event.nodeId)) return;
    this.addEffect({
      type: "ring",
      nodeId: event.nodeId,
      color: colors.finish,
      spec: FINISH_RING,
      startedAt: event.at,
    });
  }

  private addEffect(effect: Effect): void {
    this.effects = pruneEffects([...this.effects, effect], this.deps.now());
  }

  private targetPoint(): Point | null {
    const { graph } = this.deps;
    const id = this.targetId;
    if (id === null || !graph.hasNode(id)) return null;
    const { x, y } = graph.getNodeAttributes(id);
    return { x, y };
  }

  private toViewport(point: Point): Point {
    return this.deps.sigma.graphToViewport(point);
  }

  private nodeViewport(id: string): Point {
    return this.toViewport(this.deps.graph.getNodeAttributes(id));
  }

  private nodeRadius(id: string): number {
    const { sigma } = this.deps;
    return sigma.scaleSize(sigma.getNodeDisplayData(id)?.size);
  }

  private drawHalos(now: number, reducedMotion: boolean): void {
    const context = this.deps.layers.halos();
    if (context === null) return;
    const { sigma, graph, store, colors } = this.deps;
    const { width, height } = sigma.getDimensions();
    context.clearRect(0, 0, width, height);
    for (const [id, activity] of store.getState().activity.nodes) {
      const elapsed = now - activity.lastTouchedAt;
      if (!isTwinkling(elapsed) || !graph.hasNode(id)) continue;
      const fade = reducedMotion ? HALO_REDUCED_INTENSITY : (1 - elapsed / TWINKLE_MS) * twinkleFactor(elapsed);
      drawHalo(context, {
        ...this.nodeViewport(id),
        radius: this.nodeRadius(id),
        color: activityColor(colors, activity.lastKind),
        intensity: fade,
      });
    }
  }

  private drawAgentLayer(now: number, reducedMotion: boolean): void {
    const context = this.deps.layers.agent();
    if (context === null) return;
    const { width, height } = this.deps.sigma.getDimensions();
    context.clearRect(0, 0, width, height);
    context.save();
    this.drawSelection(context, now, reducedMotion);
    this.drawPath(context, now, reducedMotion);
    this.drawChangedRings(context);
    if (!reducedMotion) {
      this.drawEffects(context, now);
      this.drawTrail(context);
    }
    this.drawComet(context, now, reducedMotion);
    context.restore();
  }

  /**
   * The selected file, ringed. In the direct reach it also gets one arc per related file: importers, imports and mutual
   * imports in their own colours. Sigma leaves those pairs out (see arcNeighbours), so each relation is drawn once.
   */
  private drawSelection(context: Pen, now: number, reducedMotion: boolean): void {
    const { graph, store, palette } = this.deps;
    const state = store.getState();
    const origin = state.selected;
    if (origin === null || !graph.hasNode(origin)) return;
    const centre = this.nodeViewport(origin);
    const dashOffset = reducedMotion ? 0 : -now * ARC_FLOW_PX_PER_MS;
    for (const { id, relation } of arcLinks(graph, arcOrigin(state))) {
      const shape = arcShape(relation, centre, this.nodeViewport(id));
      drawArc(context, { ...shape, color: arcColor(palette, relation), dashOffset });
    }
    drawSelectionRing(context, centre, this.nodeRadius(origin) + 5, palette.labelStrong);
  }

  private drawPath(context: Pen, now: number, reducedMotion: boolean): void {
    const { graph, store, colors } = this.deps;
    const { status, recent } = store.getState().activity;
    if (status === "idle") return;
    const points = recent.filter((id) => graph.hasNode(id)).map((id) => this.nodeViewport(id));
    const dashOffset = reducedMotion ? 0 : -now * PATH_FLOW_PX_PER_MS;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (from === undefined || to === undefined) continue;
      const alpha = (index / points.length) * PATH_PEAK_ALPHA;
      drawPathSegment(context, { from, to, alpha, dashOffset, color: colors.finish });
    }
  }

  private drawChangedRings(context: Pen): void {
    const { graph, store, colors } = this.deps;
    const { nodes, turn } = store.getState().activity;
    for (const [id, activity] of nodes) {
      if (!isChangedThisTurn(activity, turn) || !graph.hasNode(id)) continue;
      drawChangedRing(context, this.nodeViewport(id), this.nodeRadius(id), colors.edit);
    }
  }

  private drawEffects(context: Pen, now: number): void {
    for (const effect of this.effects) {
      if (!isEffectActive(effect, now)) continue;
      if (effect.type === "ring") this.drawRingEffect(context, effect, now);
      else this.drawParticleEffect(context, effect, now);
    }
  }

  private drawRingEffect(context: Pen, effect: RingEffect, now: number): void {
    if (!this.deps.graph.hasNode(effect.nodeId)) return;
    drawRing(context, { ...this.nodeViewport(effect.nodeId), ...ringFrame(effect, now), color: effect.color });
  }

  private drawParticleEffect(context: Pen, effect: ParticleEffect, now: number): void {
    const { graph } = this.deps;
    if (!graph.hasNode(effect.fromId) || !graph.hasNode(effect.toId)) return;
    const from = this.nodeViewport(effect.fromId);
    const to = this.nodeViewport(effect.toId);
    const progress = particleProgress(effect, now);
    const tailProgress = Math.max(progress - 0.12, 0);
    const at = (amount: number): Point => ({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    });
    drawParticle(context, at(progress), at(tailProgress), effect.color);
  }

  private drawTrail(context: Pen): void {
    if (this.comet === null || this.deps.store.getState().activity.status === "idle") return;
    const points = this.comet.trail.map((point) => this.toViewport(point));
    drawTrail(context, trailSegments(points), this.deps.colors.agent);
  }

  private drawComet(context: Pen, now: number, reducedMotion: boolean): void {
    const { sigma, store, palette, colors } = this.deps;
    const { status, current } = store.getState().activity;
    const label = agentLabel(status, current);
    if (label === null) return;
    const head = this.comet === null ? null : this.toViewport(this.comet.position);
    if (head !== null) {
      const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin((now / COMET_PULSE_PERIOD_MS) * Math.PI * 2);
      drawCometHead(context, head, colors.agent, pulse);
    }
    const exploring = agentTone(status, current) === "explore";
    const fill = exploring ? palette.explore : colors.agent;
    const content = { name: exploring ? EXPLORE_NAME : AGENT_NAME, text: label, fontFamily: palette.monoFamily };
    const rect = placePill(head, measurePill(context, content), sigma.getDimensions());
    drawPill(context, rect, content, {
      background: withAlpha(fill, PILL_BACKGROUND_ALPHA),
      border: fill,
      name: palette.background,
      text: palette.background,
    });
  }
}
