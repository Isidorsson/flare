import { createStore, type StoreApi } from "zustand";

import {
  applyStatus,
  beginTurn,
  describeTouch,
  initialActivity,
  recordTouch,
  type ActivityState,
} from "./activity-state";
import type { ActivityInput, AgentStatus } from "./activity-types";
import {
  cameraAfterFitRequest,
  cameraAfterFollowToggle,
  cameraAfterUserMove,
  INITIAL_CAMERA,
  type CameraPrefs,
} from "./camera-state";
import { blastDepths } from "./blast-radius";
import type { GraphApi } from "./graph-api";
import { graphIndexFor } from "./graph-index";
import { createNodeResolver, resolveGraphNode, type NodeResolver } from "./graph-paths";
import type { GraphSnapshot } from "./graph-types";
import type { Point } from "./placement";

export type GraphStatus = "idle" | "loading" | "ready" | "error";
/** What a selected file lights up: its direct imports and importers, or everything that depends on it by distance. */
export type GraphReach = "direct" | "blast";
export type ColorBy = "role" | "language" | "directory";
export type GraphLevel = "overview" | "files";

/** Follows the selection while the reach is "blast"; it is never set on its own. */
export interface BlastState {
  readonly origin: string;
  readonly depths: ReadonlyMap<string, number>;
}

export interface GraphData {
  root: string | null;
  status: GraphStatus;
  error: string | null;
  snapshot: GraphSnapshot | null;
  resolver: NodeResolver | null;
  activity: ActivityState;
  camera: CameraPrefs;
  reach: GraphReach;
  colorBy: ColorBy;
  level: GraphLevel;
  selected: string | null;
  blast: BlastState | null;
  positions: ReadonlyMap<string, Point>;
}

export interface GraphActions {
  load: (root: string) => Promise<void>;
  reindex: () => Promise<void>;
  refresh: () => Promise<void>;
  recordActivity: (input: ActivityInput) => void;
  setAgentStatus: (status: AgentStatus) => void;
  startTurn: () => void;
  moveCameraByUser: () => void;
  fitCamera: () => void;
  toggleFollow: () => void;
  setReach: (reach: GraphReach) => void;
  setColorBy: (colorBy: ColorBy) => void;
  setLevel: (level: GraphLevel) => void;
  select: (id: string | null) => void;
  savePositions: (positions: ReadonlyMap<string, Point>) => void;
  reportFailure: (error: unknown) => void;
}

export type GraphState = GraphData & GraphActions;
export type GraphStore = StoreApi<GraphState>;

export interface GraphDeps {
  api: GraphApi;
  now: () => number;
}

interface Counter {
  current: number;
}

interface RefreshState {
  running: boolean;
  queued: boolean;
}

interface Context extends GraphDeps {
  set: GraphStore["setState"];
  get: GraphStore["getState"];
  builds: Counter;
  refresh: RefreshState;
}

function initialData(): GraphData {
  return {
    root: null,
    status: "idle",
    error: null,
    snapshot: null,
    resolver: null,
    activity: initialActivity(),
    camera: INITIAL_CAMERA,
    reach: "direct",
    colorBy: "role",
    level: "overview",
    selected: null,
    blast: null,
    positions: new Map(),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshotPatch(snapshot: GraphSnapshot, selected: string | null): Partial<GraphData> {
  const resolver = createNodeResolver(snapshot.nodes.map((node) => node.id));
  return {
    snapshot,
    resolver,
    selected: selected === null ? null : resolver.resolve(selected),
    status: "ready",
    error: null,
  };
}

function blastOf({ snapshot, reach, selected }: Pick<GraphData, "snapshot" | "reach" | "selected">): BlastState | null {
  if (reach !== "blast" || selected === null || snapshot === null) return null;
  return { origin: selected, depths: blastDepths(graphIndexFor(snapshot), selected) };
}

/** Every change to the snapshot, the selection or the reach goes through here, so the blast radius cannot drift from them. */
function patchView(context: Context, patch: Partial<GraphData>): void {
  context.set({ ...patch, blast: blastOf({ ...context.get(), ...patch }) });
}

async function runBuild(context: Context, root: string, keepView: boolean): Promise<void> {
  context.builds.current += 1;
  const token = context.builds.current;
  const { reach, colorBy, level } = context.get();
  const reset = keepView ? {} : { ...initialData(), reach, colorBy, level };
  context.set({ ...reset, root, status: "loading", error: null });
  try {
    const snapshot = await context.api.build(root);
    if (token !== context.builds.current) return;
    patchView(context, snapshotPatch(snapshot, context.get().selected));
  } catch (error) {
    if (token === context.builds.current) {
      context.set({ status: "error", error: describeError(error) });
    }
  }
}

async function runRefresh(context: Context): Promise<void> {
  if (context.refresh.running) {
    context.refresh.queued = true;
    return;
  }
  context.refresh.running = true;
  try {
    do {
      context.refresh.queued = false;
      await refreshOnce(context);
    } while (hasQueuedRefresh(context.refresh));
  } finally {
    context.refresh.running = false;
  }
}

function hasQueuedRefresh(state: RefreshState): boolean {
  return state.queued;
}

async function refreshOnce(context: Context): Promise<void> {
  if (context.get().root === null) return;
  const token = context.builds.current;
  try {
    const snapshot = await context.api.snapshot();
    if (token !== context.builds.current) return;
    patchView(context, snapshotPatch(snapshot, context.get().selected));
  } catch (error) {
    if (token === context.builds.current) {
      context.set({ error: describeError(error) });
    }
  }
}

function recordActivity(context: Context, input: ActivityInput): void {
  const { root, resolver, activity } = context.get();
  const touch = describeTouch(input, (path) => resolveGraphNode(root, resolver, path));
  context.set({ activity: recordTouch(activity, touch, context.now()) });
}

function selectFile(context: Context, id: string | null): void {
  if (context.get().selected !== id) patchView(context, { selected: id });
}

function switchReach(context: Context, reach: GraphReach): void {
  if (context.get().reach !== reach) patchView(context, { reach });
}

function reindexCurrentRoot(context: Context): Promise<void> {
  const { root } = context.get();
  return root === null ? Promise.resolve() : runBuild(context, root, true);
}

function loadRoot(context: Context, root: string): Promise<void> {
  const { root: current, status } = context.get();
  const alreadyLoaded = current === root && (status === "loading" || status === "ready");
  return alreadyLoaded ? Promise.resolve() : runBuild(context, root, false);
}

export function createGraphStore(deps: GraphDeps): GraphStore {
  return createStore<GraphState>()((set, get) => {
    const context: Context = {
      ...deps,
      set,
      get,
      builds: { current: 0 },
      refresh: { running: false, queued: false },
    };
    return {
      ...initialData(),
      load: (root) => loadRoot(context, root),
      reindex: () => reindexCurrentRoot(context),
      refresh: () => runRefresh(context),
      recordActivity: (input) => {
        recordActivity(context, input);
      },
      setAgentStatus: (status) => {
        set({ activity: applyStatus(get().activity, status, context.now()) });
      },
      startTurn: () => {
        set({ activity: beginTurn(get().activity) });
      },
      moveCameraByUser: () => {
        const current = get().camera;
        const next = cameraAfterUserMove(current);
        if (next !== current) set({ camera: next });
      },
      fitCamera: () => {
        set({ camera: cameraAfterFitRequest() });
      },
      toggleFollow: () => {
        set({ camera: cameraAfterFollowToggle(get().camera) });
      },
      setReach: (reach) => {
        switchReach(context, reach);
      },
      setColorBy: (colorBy) => {
        set({ colorBy });
      },
      setLevel: (level) => {
        set({ level });
      },
      select: (id) => {
        selectFile(context, id);
      },
      savePositions: (positions) => {
        set({ positions });
      },
      reportFailure: (error) => {
        set({ status: "error", error: describeError(error) });
      },
    };
  });
}
