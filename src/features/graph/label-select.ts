import type { Focus } from "./appearance";
import type { BlastState, GraphLevel } from "./graph-store";

export type LabelTone = "focus" | "selected" | "hot" | "blast" | "neighbour" | "hub" | "file";

export interface PlannedLabel {
  readonly id: string;
  readonly tone: LabelTone;
  readonly priority: number;
}

export const TOUCHED_LABEL_LIMIT = 14;
export const NEIGHBOUR_LABEL_LIMIT = 10;
export const BLAST_LABEL_LIMIT = 10;
const AREA_PER_LABEL = 7000;
const MIN_LABEL_BUDGET = 6;
const MAX_LABEL_BUDGET = 90;
const SMALL_GRAPH_FILES = 40;

const PRIORITY = { focus: 1000, selected: 950, blastOrigin: 900, hot: 800, blast: 700, neighbour: 600, hub: 500, workedHubBoost: 120, file: 300 } as const;

export interface LabelPlanInput {
  readonly level: GraphLevel;
  /** File ids, most important first. */
  readonly ranked: readonly string[];
  /** Folder node ids that are shown as hubs, biggest first. */
  readonly hubs: readonly string[];
  readonly focus: Focus | null;
  readonly selected: string | null;
  readonly blast: BlastState | null;
  /** Touched files with when they were last touched. */
  readonly touched: ReadonlyMap<string, number>;
  readonly budget: number;
  /** Hubs the agent has worked in; they are labelled ahead of quiet ones so their activity shows. */
  readonly workedHubs: ReadonlySet<string>;
}

/** How many ordinary file labels fit: roughly one per block of screen, more as the view zooms in. */
export function fileLabelBudget(fileCount: number, viewport: { width: number; height: number }, cameraRatio: number): number {
  if (fileCount <= SMALL_GRAPH_FILES) return fileCount;
  const zoom = 1 / Math.max(cameraRatio, 0.05);
  const byArea = (viewport.width * viewport.height) / AREA_PER_LABEL;
  return Math.round(Math.min(MAX_LABEL_BUDGET, Math.max(MIN_LABEL_BUDGET, byArea * Math.pow(zoom, 0.7))));
}

function addOnce(plan: Map<string, PlannedLabel>, id: string, tone: LabelTone, priority: number): void {
  const existing = plan.get(id);
  if (existing === undefined || existing.priority < priority) plan.set(id, { id, tone, priority });
}

function planTouched(plan: Map<string, PlannedLabel>, touched: ReadonlyMap<string, number>): void {
  const recent = [...touched.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOUCHED_LABEL_LIMIT);
  recent.forEach(([id], index) => {
    addOnce(plan, id, "hot", PRIORITY.hot - index * 0.01);
  });
}

function planBlast(plan: Map<string, PlannedLabel>, blast: BlastState | null): void {
  if (blast === null) return;
  addOnce(plan, blast.origin, "blast", PRIORITY.blastOrigin);
  let shown = 0;
  for (const [id, depth] of blast.depths ?? []) {
    if (depth !== 1) continue;
    addOnce(plan, id, "blast", PRIORITY.blast - shown * 0.01);
    shown += 1;
    if (shown >= BLAST_LABEL_LIMIT) return;
  }
}

function planFocus(plan: Map<string, PlannedLabel>, focus: Focus | null): void {
  if (focus === null) return;
  addOnce(plan, focus.node, "focus", PRIORITY.focus);
  let shown = 0;
  for (const id of focus.neighbours) {
    addOnce(plan, id, "neighbour", PRIORITY.neighbour - shown * 0.01);
    shown += 1;
    if (shown >= NEIGHBOUR_LABEL_LIMIT) return;
  }
}

/** Chooses which nodes deserve a label, best first. Placement decides which of them actually fit. */
export function planLabels(input: LabelPlanInput): PlannedLabel[] {
  const plan = new Map<string, PlannedLabel>();
  planFocus(plan, input.focus);
  if (input.selected !== null) addOnce(plan, input.selected, "selected", PRIORITY.selected);
  planBlast(plan, input.blast);
  planTouched(plan, input.touched);
  input.hubs.forEach((id, index) => {
    addOnce(plan, id, "hub", PRIORITY.hub + (input.workedHubs.has(id) ? PRIORITY.workedHubBoost : 0) - index * 0.01);
  });
  if (input.level === "files") {
    input.ranked.slice(0, input.budget).forEach((id, index) => {
      addOnce(plan, id, "file", PRIORITY.file - index * 0.01);
    });
  }
  return [...plan.values()].sort((a, b) => b.priority - a.priority);
}
