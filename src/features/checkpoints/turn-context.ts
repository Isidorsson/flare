import type { Thread } from "@/features/agent/thread-types";

import type { TurnContext } from "./checkpoint-types";

export type TurnContextResult = { ok: true; context: TurnContext } | { ok: false; reason: string };

/**
 * Where the turn that is starting runs. Snapshots are scoped by the thread's id, which exists from
 * the first message (Claude's own session id only arrives once the session is up, after the moment
 * the workspace should be snapshotted) and stays the same when a thread is resumed.
 */
export function turnContextFor(thread: Thread | null): TurnContextResult {
  if (thread === null) return { ok: false, reason: "no thread is running" };
  const anchor = thread.items.findLast((item) => item.kind === "user");
  if (anchor === undefined) return { ok: false, reason: "the turn has no user message" };
  return {
    ok: true,
    context: { threadId: thread.id, sessionId: thread.id, root: thread.cwd, anchorItemId: anchor.id },
  };
}
