import type { BridgeEvent } from "@flare/protocol";

export type ReadText = (path: string) => Promise<string | null>;

type Snapshot = { ok: true; text: string | null } | { ok: false; reason: string };

interface PendingChange {
  path: string;
  before: Promise<Snapshot>;
}

export class FileChangeCapture {
  readonly #readText: ReadText;
  readonly #pending = new Map<string, PendingChange>();

  constructor(readText: ReadText) {
    this.#readText = readText;
  }

  async begin(toolUseId: string, path: string): Promise<void> {
    let change = this.#pending.get(toolUseId);
    if (!change) {
      change = { path, before: snapshot(this.#readText, path) };
      this.#pending.set(toolUseId, change);
    }
    await change.before;
  }

  async finish(toolUseId: string, isError: boolean): Promise<BridgeEvent[]> {
    const change = this.#pending.get(toolUseId);
    if (!change) return [];
    this.#pending.delete(toolUseId);
    if (isError) return [];

    const [before, after] = await Promise.all([change.before, snapshot(this.#readText, change.path)]);
    const event = toEvent(toolUseId, change.path, before, after);
    return event === null ? [] : [event];
  }

  clear(): void {
    this.#pending.clear();
  }
}

function snapshot(readText: ReadText, path: string): Promise<Snapshot> {
  return readText(path).then(
    (text): Snapshot => ({ ok: true, text }),
    (error: unknown): Snapshot => ({ ok: false, reason: error instanceof Error ? error.message : String(error) }),
  );
}

function toEvent(toolUseId: string, path: string, before: Snapshot, after: Snapshot): BridgeEvent | null {
  if (!before.ok) return captureError(path, "before", before.reason);
  if (!after.ok) return captureError(path, "after", after.reason);
  if (after.text === null) return captureError(path, "after", "the file does not exist");
  if (before.text === after.text) return null;
  return {
    type: "file.change",
    toolUseId,
    path,
    kind: before.text === null ? "create" : "update",
    before: before.text,
    after: after.text,
  };
}

function captureError(path: string, phase: "before" | "after", reason: string): BridgeEvent {
  return { type: "error", message: `Could not capture ${path} ${phase} the change: ${reason}` };
}
