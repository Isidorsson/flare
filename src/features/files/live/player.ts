import { ActionQueue, pauseAfterMs, type Action, type EditAction, type PushOptions, type ReadAction } from "./action-queue";
import { changedLines, pauseAfterStepMs, planEdit } from "./edit-steps";
import type { EditPlay, Play, ReadPlay } from "./live-types";
import { LIVE, clearDelayMs } from "./timing";

export type TimerId = number;

export interface Scheduler {
  setTimeout: (callback: () => void, ms: number) => TimerId;
  clearTimeout: (id: TimerId) => void;
}

/** A file the player can show, with what its editor holds now. */
export interface PreparedFile {
  content: string;
  // The file was already the open editor, so the view does not jump to it.
  wasActive: boolean;
}

export interface PlayerHost {
  // Brings the file into the editor if the rules allow; null when it cannot be shown.
  prepare: (path: string, options: { forced: boolean }) => Promise<PreparedFile | null>;
  setPlay: (play: Play | null) => void;
  clearPlay: (id: number) => void;
}

interface Running {
  token: number;
  path: string;
  kind: Action["kind"];
}

/**
 * Plays queued actions one after another: reads light up lines, edits play
 * step by step, and a pause between them keeps each readable. All timing goes
 * through the scheduler so it can be driven by hand in tests.
 */
export class ActivityPlayer {
  readonly #host: PlayerHost;
  readonly #scheduler: Scheduler;
  readonly #queue = new ActionQueue();
  readonly #timers = new Set<TimerId>();
  #running: Running | null = null;
  #holding: string | null = null;
  #tokens = 0;
  #playIds = 0;

  constructor(host: PlayerHost, scheduler: Scheduler) {
    this.#host = host;
    this.#scheduler = scheduler;
  }

  nextPlayId(): number {
    this.#playIds += 1;
    return this.#playIds;
  }

  enqueue(action: Action, options?: PushOptions): void {
    this.#queue.push(action, options);
    this.#pump();
  }

  /** Stops the queue while the model is typing an edit, which takes over the editor. */
  hold(toolUseId: string): void {
    this.#holding = toolUseId;
    this.#stopRunning();
  }

  release(toolUseId: string): void {
    if (this.#holding !== toolUseId) return;
    this.#holding = null;
    this.#pump();
  }

  /** Cuts short an edit of this file that is mid-playback, so a newer one can replace it. */
  interruptEditOf(path: string): void {
    if (this.#running?.kind !== "edit" || this.#running.path !== path) return;
    this.#stopRunning();
    this.#pump();
  }

  reset(): void {
    this.#queue.clear();
    this.#holding = null;
    this.#stopRunning();
  }

  #pump(): void {
    if (this.#running !== null || this.#holding !== null) return;
    const next = this.#queue.shift();
    if (next === undefined) return;
    this.#tokens += 1;
    const running: Running = { token: this.#tokens, path: next.path, kind: next.kind };
    this.#running = running;
    this.#start(running, next).catch((error: unknown) => {
      console.error(`flare: could not show the agent's ${next.kind} of ${next.path}`, error);
      this.#finish(running.token);
    });
  }

  async #start(running: Running, action: Action): Promise<void> {
    const file = await this.#host.prepare(action.path, { forced: action.kind === "edit" && action.forced });
    if (this.#running?.token !== running.token) return;
    if (file === null) {
      if (action.kind === "edit" && action.settled) this.#host.setPlay(null);
      this.#finish(running.token);
      return;
    }
    if (action.kind === "read") this.#playRead(running.token, action, file);
    else this.#playEdit(running.token, action, file);
  }

  #playRead(token: number, action: ReadAction, file: PreparedFile): void {
    const play: ReadPlay = {
      kind: "read",
      id: this.nextPlayId(),
      path: action.path,
      request: action.request,
      instantScroll: !file.wasActive,
    };
    this.#host.setPlay(play);
    this.#clearLater(play.id, LIVE.read.clearMs);
    this.#pauseThenFinish(token, "read");
  }

  #playEdit(token: number, action: EditAction, file: PreparedFile): void {
    const plan = planEdit(action.before, file.content, { busy: this.#queue.size > 0 });
    if (plan.steps.length === 0) {
      if (action.settled) this.#host.setPlay(null);
      this.#finish(token);
      return;
    }
    const play: EditPlay = {
      kind: "edit",
      id: this.nextPlayId(),
      path: action.path,
      steps: plan.steps,
      stepIndex: 0,
      created: plan.created,
      settled: action.settled,
      instantScroll: !file.wasActive,
    };
    this.#showStep(token, play);
  }

  #showStep(token: number, play: EditPlay): void {
    this.#host.setPlay(play);
    const step = play.steps[play.stepIndex];
    if (step === undefined) return;
    if (play.stepIndex + 1 < play.steps.length) {
      this.#after(token, pauseAfterStepMs(step, play.settled), () => {
        this.#showStep(token, { ...play, stepIndex: play.stepIndex + 1 });
      });
      return;
    }
    this.#clearLater(play.id, clearDelayMs(changedLines(step), play.settled));
    this.#pauseThenFinish(token, "edit");
  }

  // The marks of a play fade on their own; this removes what is left once they have.
  #clearLater(playId: number, ms: number): void {
    this.#scheduler.setTimeout(() => {
      this.#host.clearPlay(playId);
    }, ms);
  }

  // How long the view holds on an action depends on whether something is already waiting behind it.
  #pauseThenFinish(token: number, kind: Action["kind"]): void {
    this.#after(token, pauseAfterMs(kind, this.#queue.size > 0), () => {
      this.#finish(token);
    });
  }

  #after(token: number, ms: number, run: () => void): void {
    const id = this.#scheduler.setTimeout(() => {
      this.#timers.delete(id);
      if (this.#running?.token === token) run();
    }, ms);
    this.#timers.add(id);
  }

  #finish(token: number): void {
    if (this.#running?.token !== token) return;
    this.#running = null;
    this.#pump();
  }

  #stopRunning(): void {
    this.#running = null;
    for (const id of this.#timers) this.#scheduler.clearTimeout(id);
    this.#timers.clear();
  }
}
