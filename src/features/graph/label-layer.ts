import { nodeBrightness } from "./activity-math";
import { activityColor, type ActivityPalette } from "./activity-palette";
import { folderActivity, recentlyTouched } from "./activity-summary";
import type { Focus } from "./appearance";
import type { Pen } from "./canvas-draw";
import { withAlpha } from "./color-math";
import { folderId } from "./directory-tree";
import type { GraphIndex } from "./graph-index";
import type { CodeGraph, NodeAttrs } from "./graph-model";
import type { GraphStore } from "./graph-store";
import { createMeasurer, drawPill, drawSpark, pillSize, type LabelPart, type Measure } from "./label-draw";
import {
  placeLabels,
  SIDES_FOR_FILES,
  SIDES_FOR_HUBS,
  type LabelRequest,
  type Obstacle,
  type PlacedLabel,
  type Size,
} from "./label-place";
import { fileLabelBudget, planLabels, type LabelTone, type PlannedLabel } from "./label-select";
import { activityBadge, hubLabel, truncateLabel, type FolderActivity } from "./label-text";
import type { Palette } from "./palette";
import type { Point } from "./placement";

const TOUCH_LABEL_WINDOW_MS = 180_000;
const OFFSCREEN_MARGIN = 40;
const SPARK_MIN_RADIUS = 5;
const SPARK_RADIUS_FACTOR = 1.5;
const PILL_ALPHA = 0.84;
const REQUIRED_TONES: ReadonlySet<LabelTone> = new Set(["focus", "selected", "hot", "blast"]);

export interface LabelSigma {
  getDimensions: () => Size;
  graphToViewport: (point: Point) => Point;
  scaleSize: (size?: number) => number;
  getNodeDisplayData: (id: string) => { size: number; hidden?: boolean } | undefined;
  getCamera: () => { getState: () => { ratio: number } };
}

export interface LabelDeps {
  sigma: LabelSigma;
  graph: CodeGraph;
  store: GraphStore;
  palette: Palette;
  colors: ActivityPalette;
  layer: () => Pen | null;
  now: () => number;
}

interface Resolved {
  readonly planned: PlannedLabel;
  readonly anchor: Point;
  readonly radius: number;
  readonly parts: readonly LabelPart[];
  readonly kind: "hub" | "file";
}

function isNear(point: Point, view: Size): boolean {
  return (
    point.x > -OFFSCREEN_MARGIN &&
    point.y > -OFFSCREEN_MARGIN &&
    point.x < view.width + OFFSCREEN_MARGIN &&
    point.y < view.height + OFFSCREEN_MARGIN
  );
}

/** Everything written on the graph: folder names, file names, activity sparks and the badges under folders. */
export class LabelLayer {
  private readonly deps: LabelDeps;
  private measure: Measure | null = null;
  private index: GraphIndex | null = null;
  private ranked: readonly string[] = [];
  private hubIds: readonly string[] = [];
  private focus: Focus | null = null;
  private totals: ReadonlyMap<string, FolderActivity> = new Map();

  constructor(deps: LabelDeps) {
    this.deps = deps;
  }

  setIndex(index: GraphIndex | null): void {
    this.index = index;
    if (index === null) {
      this.ranked = [];
      this.hubIds = [];
      return;
    }
    this.ranked = [...index.importance.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const sizeOf = (hub: string) => index.folders.get(hub)?.size ?? 0;
    this.hubIds = [...index.hubs].sort((a, b) => sizeOf(b) - sizeOf(a)).map(folderId);
  }

  setFocus(focus: Focus | null): void {
    this.focus = focus;
  }

  draw(): void {
    const pen = this.deps.layer();
    if (pen === null) return;
    const view = this.deps.sigma.getDimensions();
    pen.clearRect(0, 0, view.width, view.height);
    if (this.index === null || this.deps.graph.order === 0) return;
    this.measure ??= createMeasurer(pen, this.deps.palette.monoFamily);
    const measure = this.measure;
    this.drawSparks(pen, view);
    this.totals = this.folderTotals();
    const resolved = this.planned(view).flatMap((planned) => this.resolve(planned, view));
    const placed = this.place(resolved, view, measure);
    this.drawLabels(pen, resolved, placed, measure);
  }

  private planned(view: Size): PlannedLabel[] {
    const state = this.deps.store.getState();
    const ratio = this.deps.sigma.getCamera().getState().ratio;
    return planLabels({
      level: state.level,
      ranked: this.ranked,
      hubs: this.hubIds,
      focus: this.focus,
      selected: state.selected,
      blast: state.blast,
      touched: recentlyTouched(state.activity.nodes, this.deps.now(), TOUCH_LABEL_WINDOW_MS),
      budget: fileLabelBudget(this.index?.tree.size ?? 0, view, ratio),
      workedHubs: new Set(this.totals.keys()),
    });
  }

  private viewportOf(id: string): Point | null {
    const { graph, sigma } = this.deps;
    if (!graph.hasNode(id)) return null;
    const { x, y } = graph.getNodeAttributes(id);
    return sigma.graphToViewport({ x, y });
  }

  private resolve(planned: PlannedLabel, view: Size): Resolved[] {
    const { sigma, graph } = this.deps;
    const display = sigma.getNodeDisplayData(planned.id);
    const anchor = this.viewportOf(planned.id);
    if (display === undefined || display.hidden === true || anchor === null) return [];
    if (!isNear(anchor, view) && !REQUIRED_TONES.has(planned.tone)) return [];
    const attrs = graph.getNodeAttributes(planned.id);
    const radius = sigma.scaleSize(display.size);
    const isHub = attrs.kind === "folder";
    const parts = isHub ? this.hubParts(planned.id, attrs) : [this.filePart(planned, attrs.label)];
    return [{ planned, anchor, radius, parts, kind: isHub ? "hub" : "file" }];
  }

  /** What the agent has done inside each hub, keyed by the hub's node id. */
  private folderTotals(): Map<string, FolderActivity> {
    const { graph, store } = this.deps;
    const owner = (id: string) => (graph.hasNode(id) ? folderId(graph.getNodeAttribute(id, "hub")) : null);
    return folderActivity(store.getState().activity.nodes, owner);
  }

  private hubParts(id: string, attrs: NodeAttrs): LabelPart[] {
    const { palette, colors } = this.deps;
    const name = this.index?.hubNames.get(attrs.folder) ?? attrs.label;
    const label = hubLabel(name, attrs.files, attrs.folder === "");
    const parts: LabelPart[] = [{ text: label.name, color: palette.label, weight: 600 }];
    if (label.count !== "") parts.push({ text: label.count, color: palette.labelDim, weight: 500 });
    const totals = this.totals.get(id);
    const badge = totals === undefined ? null : activityBadge(totals);
    if (totals !== undefined && badge !== null) {
      parts.push({ text: badge, color: totals.edited > 0 ? colors.edit : colors.read, weight: 600 });
    }
    return parts;
  }

  private filePart(planned: PlannedLabel, label: string): LabelPart {
    const { palette, colors, store } = this.deps;
    const text = truncateLabel(label);
    const activity = store.getState().activity.nodes.get(planned.id);
    if (planned.tone === "hot" && activity !== undefined) {
      return { text, color: activityColor(colors, activity.lastKind), weight: 600 };
    }
    if (planned.tone === "focus" || planned.tone === "selected" || planned.tone === "blast") {
      return { text, color: palette.labelStrong, weight: 600 };
    }
    return { text, color: planned.tone === "file" ? palette.labelDim : palette.label, weight: 500 };
  }

  private place(resolved: readonly Resolved[], view: Size, measure: Measure): PlacedLabel[] {
    const requests: LabelRequest[] = resolved.map((item) => ({
      id: item.planned.id,
      size: pillSize(item.parts, measure),
      anchor: item.anchor,
      radius: item.radius,
      sides: item.kind === "hub" ? SIDES_FOR_HUBS : SIDES_FOR_FILES,
      required: REQUIRED_TONES.has(item.planned.tone),
    }));
    return placeLabels(requests, view, this.obstacles(view));
  }

  private obstacles(view: Size): Obstacle[] {
    const { graph, sigma, store } = this.deps;
    const filesLevel = store.getState().level === "files";
    const result: Obstacle[] = [];
    graph.forEachNode((id, attrs) => {
      if (attrs.kind === "file" && !filesLevel) return;
      const display = sigma.getNodeDisplayData(id);
      if (display === undefined || display.hidden === true) return;
      const point = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      if (isNear(point, view)) result.push({ id, x: point.x, y: point.y, radius: sigma.scaleSize(display.size) });
    });
    return result;
  }

  private drawLabels(pen: Pen, resolved: readonly Resolved[], placed: readonly PlacedLabel[], measure: Measure): void {
    const { palette, colors, store } = this.deps;
    const byId = new Map(resolved.map((item) => [item.planned.id, item]));
    for (const label of placed) {
      const item = byId.get(label.id);
      if (item === undefined) continue;
      const activity = store.getState().activity.nodes.get(label.id);
      const hot = item.planned.tone === "hot" && activity !== undefined;
      const worked = this.totals.has(label.id);
      const accent = hot ? activityColor(colors, activity.lastKind) : worked ? colors.edit : palette.label;
      drawPill(pen, label.rect, item.parts, {
        background: withAlpha(palette.panel, PILL_ALPHA),
        border: withAlpha(accent, hot || worked ? 0.5 : 0.2),
        family: palette.monoFamily,
        measure,
      });
    }
  }

  private drawSparks(pen: Pen, view: Size): void {
    const { sigma, store, colors, now } = this.deps;
    for (const [id, activity] of store.getState().activity.nodes) {
      const display = sigma.getNodeDisplayData(id);
      const anchor = this.viewportOf(id);
      if (display === undefined || display.hidden === true || anchor === null || !isNear(anchor, view)) continue;
      const radius = Math.max(SPARK_MIN_RADIUS, sigma.scaleSize(display.size) * SPARK_RADIUS_FACTOR);
      const intensity = nodeBrightness(now() - activity.lastTouchedAt, false);
      drawSpark(pen, { center: anchor, radius, color: activityColor(colors, activity.lastKind), intensity });
    }
  }
}
