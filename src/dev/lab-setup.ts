import { graphStore, recordAgentActivity } from "@/features/graph";
import type { ColorBy } from "@/features/graph/graph-store";
import type { GraphSnapshot } from "@/features/graph/graph-types";
import { workspaceStore } from "@/features/workspace/use-workspace";

import { agentScript, generateSnapshot, isFixtureSize, type FixtureSize, type ScriptStep } from "./graph-fixtures";
import { setStubSnapshot } from "./tauri-stub";

export const STEP_MS = 850;
export const WIDTHS = { narrow: 420, medium: 720, full: 0 } as const;
export const WIDTH_NAMES = ["narrow", "medium", "full"] as const;
export type WidthName = (typeof WIDTH_NAMES)[number];

const EDITED_LINES = 24;

const params = new URLSearchParams(window.location.search);

export function sizeFromParams(): FixtureSize {
  const value = params.get("size");
  return isFixtureSize(value) ? value : "medium";
}

export function shouldAutoplay(): boolean {
  return params.get("play") === "1";
}

function colorFromParams(): ColorBy {
  const value = params.get("color");
  return value === "language" || value === "directory" ? value : "role";
}

export function applyZoomParam(): void {
  const zoom = Number(params.get("zoom"));
  if (zoom > 0 && zoom !== 1) document.documentElement.style.setProperty("zoom", String(zoom));
}

function busiestFile(snapshot: GraphSnapshot): string | null {
  const counts = new Map<string, number>();
  for (const { target } of snapshot.edges) counts.set(target, (counts.get(target) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top === undefined ? null : top[0];
}

/** `?select=top` picks the most imported file; any other value is taken as a file id. */
function fileToSelect(snapshot: GraphSnapshot): string | null {
  const wanted = params.get("select");
  if (wanted === "top") return busiestFile(snapshot);
  return snapshot.nodes.some((node) => node.id === wanted) ? wanted : null;
}

async function loadAndSelect(snapshot: GraphSnapshot): Promise<void> {
  await graphStore.getState().load(snapshot.root);
  const selected = fileToSelect(snapshot);
  if (selected !== null) graphStore.getState().select(selected);
}

/** Points the stubbed backend at a generated project and loads it into the real graph store. */
export function openFixture(size: FixtureSize): ScriptStep[] {
  const snapshot = generateSnapshot(size);
  setStubSnapshot(snapshot);
  workspaceStore.getState().setRoot(snapshot.root);
  graphStore.getState().setColorBy(colorFromParams());
  graphStore.getState().setReach(params.get("reach") === "blast" ? "blast" : "direct");
  graphStore.getState().setLevel(params.get("level") === "files" ? "files" : "overview");
  void loadAndSelect(snapshot);
  return agentScript(snapshot);
}

export function applyStep(step: ScriptStep): void {
  recordAgentActivity({
    kind: step.kind,
    path: step.path,
    detail: step.detail,
    linesChanged: step.kind === "read" ? 0 : EDITED_LINES,
  });
}
