import type { ReadRequest } from "./live-types";
import { LIVE } from "./timing";

export interface ReadAction {
  kind: "read";
  path: string;
  request: ReadRequest;
}

export interface EditAction {
  kind: "edit";
  path: string;
  // The text before the change; null when the change created the file.
  before: string | null;
  after: string;
  // The edit was typed out on screen already, so it only has to settle.
  settled: boolean;
  // The user asked for this, so it ignores the rules that keep the agent from taking the editor.
  forced: boolean;
}

export type Action = ReadAction | EditAction;
export type ActionKind = Action["kind"];

export interface PushOptions {
  front?: boolean;
}

/**
 * The single line of things for the live view to show. Edits to a file that
 * are still waiting fold into one, and a long line drops its oldest reads
 * (never an edit) so the view does not fall behind the agent.
 */
export class ActionQueue {
  #items: Action[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(action: Action, { front = false }: PushOptions = {}): void {
    if (!(action.kind === "edit" && this.#mergeEdit(action))) {
      this.#items = front ? [action, ...this.#items] : [...this.#items, action];
    }
    this.#dropOldReads();
  }

  shift(): Action | undefined {
    return this.#items.shift();
  }

  clear(): void {
    this.#items = [];
  }

  #mergeEdit(next: EditAction): boolean {
    const index = this.#items.findIndex((item) => item.kind === "edit" && item.path === next.path);
    const waiting = this.#items[index];
    if (waiting?.kind !== "edit") return false;
    this.#items[index] = {
      kind: "edit",
      path: next.path,
      before: waiting.before,
      after: next.after,
      settled: waiting.settled && next.settled,
      forced: waiting.forced || next.forced,
    };
    return true;
  }

  #dropOldReads(): void {
    while (this.#items.length > LIVE.pacing.maxQueued) {
      const oldest = this.#items.findIndex((item) => item.kind === "read");
      if (oldest < 0) return;
      this.#items.splice(oldest, 1);
    }
  }
}

/** How long to hold the view on an action before moving to the next one. */
export function pauseAfterMs(kind: ActionKind, moreQueued: boolean): number {
  const pause = kind === "read" ? LIVE.pacing.afterRead : LIVE.pacing.afterEdit;
  return moreQueued ? pause.busyMs : pause.idleMs;
}
