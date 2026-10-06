import { baseName } from "@/shared/lib/path-name";

import {
  isEditKind,
  type ActivityInput,
  type ActivityKind,
  type ActivitySource,
  type AgentStatus,
} from "./activity-types";

export const RECENT_LIMIT = 12;
export const COMET_IDLE_MS = 1500;
const MAX_SUBJECT_LENGTH = 36;

const VERBS: Readonly<Record<ActivityKind, string>> = {
  read: "Reading",
  edit: "Editing",
  create: "Creating",
  search: "Searching",
  run: "Running",
};

export interface NodeActivity {
  readonly reads: number;
  readonly edits: number;
  readonly linesChanged: number;
  readonly lastKind: ActivityKind;
  readonly lastTouchedAt: number;
  readonly changedTurn: number | null;
}

const EMPTY_NODE: NodeActivity = {
  reads: 0,
  edits: 0,
  linesChanged: 0,
  lastKind: "read",
  lastTouchedAt: 0,
  changedTurn: null,
};

export interface CurrentAction {
  readonly kind: ActivityKind;
  readonly subject: string | null;
}

export interface TouchActivity {
  readonly type: "touch";
  readonly seq: number;
  readonly at: number;
  readonly kind: ActivityKind;
  readonly nodeId: string | null;
  readonly from: string | null;
  readonly movesComet: boolean;
}

export interface FinishActivity {
  readonly type: "finish";
  readonly seq: number;
  readonly at: number;
  readonly nodeId: string | null;
}

export type ActivityEvent = TouchActivity | FinishActivity;

export interface ActivityState {
  readonly nodes: ReadonlyMap<string, NodeActivity>;
  readonly recent: readonly string[];
  readonly status: AgentStatus;
  readonly current: CurrentAction | null;
  readonly lastNodeId: string | null;
  readonly lastMoveAt: number | null;
  readonly turn: number;
  /** Lines the agent has changed since the current turn began. */
  readonly turnLines: number;
  readonly seq: number;
  readonly lastEvent: ActivityEvent | null;
}

export interface Touch {
  readonly nodeId: string | null;
  readonly kind: ActivityKind;
  readonly subject: string | null;
  readonly linesChanged: number;
  readonly source: ActivitySource;
}

export type ResolveNode = (path: string) => string | null;

export function initialActivity(): ActivityState {
  return {
    nodes: new Map(),
    recent: [],
    status: "idle",
    current: null,
    lastNodeId: null,
    lastMoveAt: null,
    turn: 1,
    turnLines: 0,
    seq: 0,
    lastEvent: null,
  };
}

function subjectOf(input: ActivityInput): string | null {
  const file = input.path === undefined ? null : baseName(input.path);
  const preferDetail = input.kind === "search" || input.kind === "run";
  const subject = preferDetail ? (input.detail ?? file) : (file ?? input.detail ?? null);
  return subject === null || subject === "" ? null : subject;
}

export function describeTouch(input: ActivityInput, resolve: ResolveNode): Touch {
  return {
    nodeId: input.path === undefined ? null : resolve(input.path),
    kind: input.kind,
    subject: subjectOf(input),
    linesChanged: Math.max(input.linesChanged ?? 0, 0),
    source: input.source ?? "agent",
  };
}

export function pushRecent(recent: readonly string[], nodeId: string): readonly string[] {
  return [...recent.filter((id) => id !== nodeId), nodeId].slice(-RECENT_LIMIT);
}

function movesComet(state: ActivityState, touch: Touch, now: number): boolean {
  if (touch.source === "agent") return true;
  if (state.status === "idle") return false;
  return state.lastMoveAt === null || now - state.lastMoveAt > COMET_IDLE_MS;
}

function touchNode(
  previous: NodeActivity = EMPTY_NODE,
  touch: Touch,
  context: { now: number; turn: number },
): NodeActivity {
  const base: NodeActivity = { ...previous, lastKind: touch.kind, lastTouchedAt: context.now };
  if (touch.source !== "agent") return base;
  if (!isEditKind(touch.kind)) return { ...base, reads: previous.reads + 1 };
  return {
    ...base,
    edits: previous.edits + 1,
    linesChanged: previous.linesChanged + touch.linesChanged,
    changedTurn: context.turn,
  };
}

function withTouchedNode(state: ActivityState, touch: Touch, now: number): ReadonlyMap<string, NodeActivity> {
  if (touch.nodeId === null) return state.nodes;
  const next = new Map(state.nodes);
  next.set(touch.nodeId, touchNode(state.nodes.get(touch.nodeId), touch, { now, turn: state.turn }));
  return next;
}

function changedLines(touch: Touch): number {
  return touch.source === "agent" && isEditKind(touch.kind) ? touch.linesChanged : 0;
}

export function recordTouch(state: ActivityState, touch: Touch, now: number): ActivityState {
  const moves = movesComet(state, touch, now);
  const seq = state.seq + 1;
  const landed = moves ? touch.nodeId : null;
  return {
    ...state,
    nodes: withTouchedNode(state, touch, now),
    recent: landed === null ? state.recent : pushRecent(state.recent, landed),
    status: touch.source === "agent" ? "working" : state.status,
    current: moves ? { kind: touch.kind, subject: touch.subject } : state.current,
    lastNodeId: landed ?? state.lastNodeId,
    lastMoveAt: moves ? now : state.lastMoveAt,
    turnLines: state.turnLines + changedLines(touch),
    seq,
    lastEvent: {
      type: "touch",
      seq,
      at: now,
      kind: touch.kind,
      nodeId: touch.nodeId,
      from: state.lastNodeId,
      movesComet: moves,
    },
  };
}

export function applyStatus(state: ActivityState, status: AgentStatus, now: number): ActivityState {
  if (status === state.status) return state;
  const next: ActivityState = { ...state, status, current: status === "working" ? state.current : null };
  if (status !== "done") return next;
  const seq = state.seq + 1;
  return { ...next, seq, lastEvent: { type: "finish", seq, at: now, nodeId: state.lastNodeId } };
}

export function beginTurn(state: ActivityState): ActivityState {
  return { ...state, turn: state.turn + 1, turnLines: 0 };
}

export function isChangedThisTurn(activity: NodeActivity, turn: number): boolean {
  return activity.changedTurn === turn;
}

function truncate(text: string): string {
  return text.length <= MAX_SUBJECT_LENGTH ? text : `${text.slice(0, MAX_SUBJECT_LENGTH - 1)}…`;
}

function describeAction(action: CurrentAction | null): string {
  if (action === null) return "Working";
  const verb = VERBS[action.kind];
  return action.subject === null ? verb : `${verb} · ${truncate(action.subject)}`;
}

/** Reading and thinking look like exploring; changing things is the agent at work. */
export function agentTone(status: AgentStatus, current: CurrentAction | null): "agent" | "explore" {
  if (status === "thinking") return "explore";
  const reading = current?.kind === "read" || current?.kind === "search";
  return status === "working" && reading ? "explore" : "agent";
}

export function agentLabel(status: AgentStatus, current: CurrentAction | null): string | null {
  switch (status) {
    case "idle":
      return null;
    case "thinking":
      return "Thinking";
    case "done":
      return "Done";
    case "working":
      return describeAction(current);
  }
}
