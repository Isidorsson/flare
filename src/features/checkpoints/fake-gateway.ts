import type { CheckpointGateway } from "./checkpoint-gateway";
import type { FileDelta, PlannedFile, Snapshot } from "./checkpoint-schemas";

export const DEFAULT_FILES: FileDelta[] = [{ path: "src/a.ts", status: "modified", added: 2, removed: 1 }];
export const DEFAULT_PLAN: PlannedFile[] = [{ path: "src/a.ts", action: "revert", conflict: false }];

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  const handlers: Pick<Deferred<T>, "resolve" | "reject"> = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, ...handlers };
}

export function snapshot(turn: number, phase: "start" | "end", warnings: string[] = []): Snapshot {
  return { sessionId: "s1", turn, phase, commit: `commit-${String(turn)}-${phase}`, createdAt: 1, store: "git", warnings };
}

export interface FakeGateway {
  gateway: CheckpointGateway;
  /** One line per call, in order, e.g. "create end 2" or "restore undoTurn 1 force=true". */
  calls: string[];
}

function describeRestore(request: { kind: string } & Record<string, unknown>): string {
  const target = request.turn ?? request.restore;
  return `${request.kind} ${String(target)}`;
}

/**
 * A gateway whose calls are recorded and answered with plausible defaults: each start gets the next
 * turn number. Pass overrides to script failures, conflicts or calls that stay pending.
 */
export function createFakeGateway(overrides: Partial<CheckpointGateway> = {}): FakeGateway {
  const calls: string[] = [];
  let turns = 0;
  const defaults: CheckpointGateway = {
    create: (input) => {
      if (input.phase === "start") turns += 1;
      return Promise.resolve(snapshot(input.phase === "start" ? turns : input.turn, input.phase));
    },
    list: () => Promise.resolve({ store: "git", turns: [], restores: [] }),
    diff: (input) =>
      Promise.resolve({ turn: input.turn, files: DEFAULT_FILES, added: 2, removed: 1 }),
    plan: () => Promise.resolve({ files: DEFAULT_PLAN }),
    restore: () => Promise.resolve({ status: "restored", restore: 1, files: DEFAULT_PLAN, warnings: [] }),
    prune: () => Promise.resolve({ removedRefs: 0 }),
  };
  const pick = <K extends keyof CheckpointGateway>(name: K): CheckpointGateway[K] => overrides[name] ?? defaults[name];

  const gateway: CheckpointGateway = {
    create: (input) => {
      calls.push(input.phase === "start" ? "create start" : `create end ${String(input.turn)}`);
      return pick("create")(input);
    },
    list: (input) => {
      calls.push("list");
      return pick("list")(input);
    },
    diff: (input) => {
      calls.push(`diff ${String(input.turn)}`);
      return pick("diff")(input);
    },
    plan: (input) => {
      calls.push(`plan ${describeRestore(input.request)}`);
      return pick("plan")(input);
    },
    restore: (input) => {
      calls.push(`restore ${describeRestore(input.request)} force=${String(input.force)}`);
      return pick("restore")(input);
    },
    prune: (root) => {
      calls.push(`prune ${root}`);
      return pick("prune")(root);
    },
  };
  return { gateway, calls };
}
