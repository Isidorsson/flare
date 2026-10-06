import { describeError } from "@/shared/lib/describe-error";

import type { CheckpointGateway } from "./checkpoint-gateway";
import type { RestoreResult } from "./checkpoint-schemas";
import type { CheckpointNotice, PendingRestore, RestoreTarget, TurnContext, TurnRecord } from "./checkpoint-types";
import { errorNotice, infoNotice, restoredNotice } from "./restore-labels";

export interface CheckpointSnapshot {
  /** Every turn recorded this run, in the order the turns started. */
  records: TurnRecord[];
  /** A restore waiting for the user to look at the files it will change. */
  pending: PendingRestore | null;
  notice: CheckpointNotice | null;
  /** Files are being written; nothing else may be restored meanwhile. */
  restoring: boolean;
}

export interface StoreAccess {
  get(): CheckpointSnapshot;
  set(update: (state: CheckpointSnapshot) => Partial<CheckpointSnapshot>): void;
}

export interface CheckpointDeps {
  gateway: CheckpointGateway;
  now: () => number;
  createId: () => string;
}

const NOTHING_TO_CHANGE = "Nothing to change: the files already match.";

export const INITIAL_SNAPSHOT: CheckpointSnapshot = { records: [], pending: null, notice: null, restoring: false };

function newRecord(id: string, context: TurnContext, startedAt: number): TurnRecord {
  return {
    ...context,
    id,
    turn: null,
    status: "open",
    startedAt,
    files: [],
    added: 0,
    removed: 0,
    warnings: [],
    error: null,
  };
}

/** Records snapshots around each agent turn and runs the confirm-then-restore flow. */
export class CheckpointController {
  readonly #deps: CheckpointDeps;
  readonly #store: StoreAccess;
  readonly #prunedRoots = new Set<string>();
  // Snapshots of one workspace are taken in order: an end needs the turn number its start returned.
  #queue: Promise<void> = Promise.resolve();
  #open: { id: string; threadId: string } | null = null;

  constructor(deps: CheckpointDeps, store: StoreAccess) {
    this.#deps = deps;
    this.#store = store;
  }

  /** A turn that is already being recorded for the same thread is kept: both triggers may fire for it. */
  startTurn(context: TurnContext): void {
    if (this.#open?.threadId === context.threadId) return;
    this.endTurn();
    const id = this.#deps.createId();
    this.#open = { id, threadId: context.threadId };
    const record = newRecord(id, context, this.#deps.now());
    this.#store.set((state) => ({ records: [...state.records, record], notice: null }));
    this.#enqueue(() => this.#recordStart(id, context));
  }

  endTurn(): void {
    if (this.#open === null) return;
    const { id } = this.#open;
    this.#open = null;
    this.#patchRecord(id, { status: "closing" });
    this.#enqueue(() => this.#recordEnd(id));
  }

  reportUnavailable(reason: string): void {
    this.#show(errorNotice(`Undo is unavailable for this turn: ${reason}`));
  }

  pruneWorkspace(root: string): void {
    if (this.#prunedRoots.has(root)) return;
    this.#prunedRoots.add(root);
    this.#enqueue(async () => {
      try {
        await this.#deps.gateway.prune(root);
      } catch (error) {
        console.error("flare: could not clear old checkpoints", error);
      }
    });
  }

  requestRestore(target: RestoreTarget): void {
    const { pending, restoring } = this.#store.get();
    if (pending !== null || restoring) return;
    this.#store.set(() => ({ pending: { target, status: "planning", files: [] }, notice: null }));
    this.#track(this.#planRestore(target));
  }

  confirmRestore(): void {
    const { pending, restoring } = this.#store.get();
    if (pending?.status !== "ready" || restoring) return;
    const force = pending.files.some((file) => file.conflict);
    this.#store.set(() => ({ pending: { ...pending, status: "restoring" } }));
    this.#track(this.#performRestore(pending.target, force));
  }

  cancelRestore(): void {
    if (this.#store.get().pending?.status === "restoring") return;
    this.#store.set(() => ({ pending: null }));
  }

  runNoticeAction(): void {
    const { notice, restoring, pending } = this.#store.get();
    if (notice?.action == null || restoring || pending !== null) return;
    this.#store.set(() => ({ notice: null }));
    this.#track(this.#performRestore(notice.action.target, false));
  }

  dismissNotice(): void {
    this.#store.set(() => ({ notice: null }));
  }

  async #recordStart(id: string, context: TurnContext): Promise<void> {
    try {
      const { root, sessionId } = context;
      const snapshot = await this.#deps.gateway.create({ root, sessionId, phase: "start" });
      this.#patchRecord(id, { turn: snapshot.turn, warnings: snapshot.warnings });
    } catch (error) {
      this.#failRecord(id, error);
    }
  }

  async #recordEnd(id: string): Promise<void> {
    const record = this.#store.get().records.find((candidate) => candidate.id === id);
    if (record === undefined || record.status === "failed" || record.turn === null) return;
    const { root, sessionId, turn } = record;
    try {
      const end = await this.#deps.gateway.create({ root, sessionId, phase: "end", turn });
      const diff = await this.#deps.gateway.diff({ root, sessionId, turn });
      this.#patchRecord(id, {
        status: "ready",
        files: diff.files,
        added: diff.added,
        removed: diff.removed,
        warnings: [...record.warnings, ...end.warnings],
      });
    } catch (error) {
      this.#failRecord(id, error);
    }
  }

  async #planRestore(target: RestoreTarget): Promise<void> {
    try {
      const { root, sessionId, request } = target;
      const plan = await this.#deps.gateway.plan({ root, sessionId, request });
      if (this.#store.get().pending?.target !== target) return;
      if (plan.files.length === 0) {
        this.#store.set(() => ({ pending: null, notice: infoNotice(NOTHING_TO_CHANGE) }));
        return;
      }
      this.#store.set(() => ({ pending: { target, status: "ready", files: plan.files } }));
    } catch (error) {
      this.#store.set(() => ({
        pending: null,
        notice: errorNotice(`Could not check what would change: ${describeError(error)}`),
      }));
    }
  }

  async #performRestore(target: RestoreTarget, force: boolean): Promise<void> {
    this.#store.set(() => ({ restoring: true }));
    try {
      const { root, sessionId, request } = target;
      this.#showResult(target, await this.#deps.gateway.restore({ root, sessionId, request, force }));
    } catch (error) {
      this.#store.set(() => ({
        pending: null,
        notice: errorNotice(`Could not restore the files: ${describeError(error)}`),
      }));
    } finally {
      this.#store.set(() => ({ restoring: false }));
    }
  }

  #showResult(target: RestoreTarget, result: RestoreResult): void {
    switch (result.status) {
      case "restored":
        this.#store.set(() => ({ pending: null, notice: restoredNotice(target, result) }));
        return;
      case "conflicts":
        this.#store.set(() => ({ pending: { target, status: "ready", files: result.files }, notice: null }));
        return;
      case "unchanged":
        this.#store.set(() => ({ pending: null, notice: infoNotice(NOTHING_TO_CHANGE) }));
        return;
    }
  }

  #failRecord(id: string, error: unknown): void {
    const message = describeError(error);
    this.#patchRecord(id, { status: "failed", error: message });
    this.reportUnavailable(message);
  }

  #patchRecord(id: string, patch: Partial<TurnRecord>): void {
    this.#store.set((state) => ({
      records: state.records.map((record) => (record.id === id ? { ...record, ...patch } : record)),
    }));
  }

  #show(notice: CheckpointNotice): void {
    this.#store.set(() => ({ notice }));
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(task).catch((error: unknown) => {
      this.#show(errorNotice(describeError(error)));
    });
  }

  #track(work: Promise<void>): void {
    work.catch((error: unknown) => {
      this.#show(errorNotice(describeError(error)));
    });
  }
}
