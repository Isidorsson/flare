import { graphStore, recordAgentActivity } from "@/features/graph";
import type { ColorBy } from "@/features/graph/graph-store";
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

/** Points the stubbed backend at a generated project and loads it into the real graph store. */
export function openFixture(size: FixtureSize): ScriptStep[] {
  const snapshot = generateSnapshot(size);
  setStubSnapshot(snapshot);
  workspaceStore.getState().setRoot(snapshot.root);
  graphStore.getState().setColorBy(colorFromParams());
  graphStore.getState().setLevel(params.get("level") === "files" ? "files" : "overview");
  void graphStore.getState().load(snapshot.root);
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
