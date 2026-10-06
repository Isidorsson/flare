import { parentDir } from "../paths";
import type { TouchKind } from "./live-types";
import { LIVE } from "./timing";

export interface Touch {
  at: number;
  edits: number;
  reads: number;
  // Lines the agent changed in this file, added and removed together.
  lines: number;
  lastKind: TouchKind;
}

export type Touches = Readonly<Record<string, Touch>>;

export interface HeatEntry {
  // 0 to 1.
  level: number;
  // The level in whole steps from 1 to the number of heat levels, for styling.
  step: number;
  // Edit when the agent ever changed the file, otherwise read.
  kind: TouchKind;
  // What the agent did to it last.
  lastKind: TouchKind;
  touchedAt: number;
  // 1 to 5 for the most recently touched files.
  badge: number | null;
}

export interface HeatView {
  now: number;
  files: ReadonlyMap<string, HeatEntry>;
  // Folders with something hot inside.
  sparks: ReadonlySet<string>;
}

const EMPTY_TOUCH: Touch = { at: 0, edits: 0, reads: 0, lines: 0, lastKind: "read" };

// After this long even the hottest file has cooled below the floor.
const MAX_AGE_MS = -LIVE.heat.decayMs * Math.log(LIVE.heat.floor);

export interface TouchEvent {
  kind: TouchKind;
  // Lines the agent changed; only edits count them.
  lines: number;
  at: number;
}

export function recordTouch(touches: Touches, path: string, { kind, lines, at }: TouchEvent): Touches {
  const previous = touches[path] ?? EMPTY_TOUCH;
  const next: Touch = {
    at,
    edits: previous.edits + (kind === "edit" ? 1 : 0),
    reads: previous.reads + (kind === "read" ? 1 : 0),
    lines: previous.lines + (kind === "edit" ? lines : 0),
    lastKind: kind,
  };
  return { ...touches, [path]: next };
}

/** Whether the agent touched the file only moments ago. */
export function isPulsing(entry: HeatEntry, now: number): boolean {
  return now - entry.touchedAt < LIVE.tab.pulseMs;
}

/** Forgets files that have cooled off completely. */
export function pruneTouches(touches: Touches, now: number): Touches {
  const kept = Object.entries(touches).filter(([, touch]) => now - touch.at < MAX_AGE_MS);
  return kept.length === Object.keys(touches).length ? touches : Object.fromEntries(kept);
}

/** How hot a file is: it decays with time and starts higher the more the agent did to it. */
export function heatLevel(touch: Touch, now: number): number {
  const { decayMs, base, span, editWeight, lineDivisor, readWeight } = LIVE.heat;
  const age = Math.max(0, now - touch.at);
  const activity = Math.min(1, touch.edits * editWeight + touch.lines / lineDivisor + touch.reads * readWeight);
  return Math.exp(-age / decayMs) * (base + span * activity);
}

function heatStep(level: number): number {
  return Math.min(LIVE.heat.levels, Math.max(1, Math.ceil(level * LIVE.heat.levels)));
}

export function buildHeatView(touches: Touches, now: number): HeatView {
  const hot = Object.entries(touches)
    .map(([path, touch]) => ({ path, touch, level: heatLevel(touch, now) }))
    .filter((entry) => entry.level >= LIVE.heat.floor);
  const recent = [...hot].sort((a, b) => b.touch.at - a.touch.at || a.path.localeCompare(b.path)).slice(0, LIVE.heat.badges);
  const files = new Map<string, HeatEntry>();
  for (const { path, touch, level } of hot) {
    const rank = recent.findIndex((entry) => entry.path === path);
    files.set(path, {
      level,
      step: heatStep(level),
      kind: touch.edits > 0 ? "edit" : "read",
      lastKind: touch.lastKind,
      touchedAt: touch.at,
      badge: rank < 0 ? null : rank + 1,
    });
  }
  return { now, files, sparks: ancestorsOf(hot.map((entry) => entry.path)) };
}

function ancestorsOf(paths: readonly string[]): Set<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    for (let dir = parentDir(path); dir !== null && !folders.has(dir); dir = parentDir(dir)) folders.add(dir);
  }
  return folders;
}
