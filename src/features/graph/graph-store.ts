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
import type { GraphApi } from "./graph-api";
import { createNodeResolver, resolveGraphNode, type NodeResolver } from "./graph-paths";
import type { BlastRadius, GraphSnapshot } from "./graph-types";
import type { Point } from "./placement";

export type GraphStatus = "idle" | "loading" | "ready" | "error";
export type GraphMode = "explore" | "blast";
export type ColorBy = "role" | "language" | "directory";
export type GraphLevel = "overview" | "files";

export interface BlastState {
  readonly origin: string;
  readonly depths: ReadonlyMap<string, number> | null;
}

export interface GraphData {
  root: string | null;
  status: GraphStatus;
  error: string | null;
  snapshot: GraphSnapshot | null;
  resolver: NodeResolver | null;
  activity: ActivityState;
  camera: CameraPrefs;
  mode: GraphMode;
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
  setMode: (mode: GraphMode) => void;
  setColorBy: (colorBy: ColorBy) => void;
  setLevel: (level: GraphLevel) => void;
  select: (id: string | null) => void;
  inspectBlast: (path: string) => Promise<void>;
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
  blasts: Counter;
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
    mode: "explore",
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

function toDepthMap(radius: BlastRadius): ReadonlyMap<string, number> {
  return new Map(radius.nodes.map((node) => [node.id, node.depth]));
}

async function runBuild(context: Context, root: string, keepView: boolean): Promise<void> {
  context.builds.current += 1;
  const token = context.builds.current;
  const { mode, colorBy, level } = context.get();
  const reset = keepView ? {} : { ...initialData(), mode, colorBy, level };
  context.set({ ...reset, root, status: "loading", error: null });
  try {
    const snapshot = await context.api.build(root);
    if (token !== context.builds.current) return;
    context.set(snapshotPatch(snapshot, context.get().selected));
    await refreshBlast(context);
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
    context.set(snapshotPatch(snapshot, context.get().selected));
    await refreshBlast(context);
  } catch (error) {
    if (token === context.builds.current) {
      context.set({ error: describeError(error) });
    }
  }
}

async function refreshBlast(context: Context): Promise<void> {
  const { blast, resolver } = context.get();
  if (blast === null) return;
  const stillIndexed = resolver !== null && resolver.resolve(blast.origin) !== null;
  if (!stillIndexed) {
    context.set({ blast: null });
    return;
  }
  await runBlast(context, blast.origin);
}

async function runBlast(context: Context, path: string): Promise<void> {
  context.blasts.current += 1;
  const token = context.blasts.current;
  const previous = context.get().blast;
  const depths = previous?.origin === path ? previous.depths : null;
  context.set({ blast: { origin: path, depths } });
  try {
    const radius = await context.api.blastRadius(path);
    if (token !== context.blasts.current) return;
    context.set({ blast: { origin: radius.origin, depths: toDepthMap(radius) }, error: null });
  } catch (error) {
    if (token !== context.blasts.current) return;
    context.set({ blast: null, error: describeError(error) });
  }
}

function recordActivity(context: Context, input: ActivityInput): void {
  const { root, resolver, activity } = context.get();
  const touch = describeTouch(input, (path) => resolveGraphNode(root, resolver, path));
  context.set({ activity: recordTouch(activity, touch, context.now()) });
}

function switchMode(context: Context, mode: GraphMode): void {
  if (mode === "explore") context.blasts.current += 1;
  context.set({ mode, blast: mode === "explore" ? null : context.get().blast });
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
      blasts: { current: 0 },
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
      setMode: (mode) => {
        switchMode(context, mode);
      },
      setColorBy: (colorBy) => {
        set({ colorBy });
      },
      setLevel: (level) => {
        set({ level });
      },
      select: (id) => {
        set({ selected: id });
      },
      inspectBlast: (path) => runBlast(context, path),
      savePositions: (positions) => {
        set({ positions });
      },
      reportFailure: (error) => {
        set({ status: "error", error: describeError(error) });
      },
    };
  });
}
