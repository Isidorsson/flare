import {
  commitGenerateSchema,
  MAX_COMMIT_RECENT_SUBJECTS,
  type AppMessage,
} from "@flare/protocol";

import type { AgentEventListener } from "./agent-events";

export interface CommitMessageInput {
  stat: string;
  patch: string;
  truncated: boolean;
  recentSubjects: string[];
  includeBody: boolean;
}

export interface CommitMessage {
  subject: string;
  body: string | null;
}

export type GenerateCommitMessage = (input: CommitMessageInput) => Promise<CommitMessage>;

export interface CommitMessageClientDeps {
  send: (message: AppMessage) => Promise<void>;
  subscribe: (listener: AgentEventListener) => () => void;
  createId: () => string;
  timeoutMs: number;
}

type Outcome = { ok: true; message: CommitMessage } | { ok: false; error: Error };

interface PendingReply {
  // Never rejects, so a reply that lands while the request is still being sent cannot go unhandled.
  outcome: Promise<Outcome>;
  cancel: () => void;
}

export function createCommitMessageClient(deps: CommitMessageClientDeps): GenerateCommitMessage {
  return async (input) => {
    const request = commitGenerateSchema.parse({
      type: "commit.generate",
      requestId: deps.createId(),
      ...input,
      recentSubjects: input.recentSubjects.slice(0, MAX_COMMIT_RECENT_SUBJECTS),
    });
    const reply = awaitReply(deps, request.requestId);
    try {
      await deps.send(request);
    } catch (error) {
      reply.cancel();
      throw error;
    }
    const outcome = await reply.outcome;
    if (!outcome.ok) throw outcome.error;
    return outcome.message;
  };
}

function awaitReply(deps: CommitMessageClientDeps, requestId: string): PendingReply {
  let stop: () => void = () => undefined;
  const outcome = new Promise<Outcome>((resolve) => {
    const settle = (result: Outcome) => {
      stop();
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle({ ok: false, error: new Error(`Timed out after ${String(deps.timeoutMs / 1000)}s waiting for the commit message`) });
    }, deps.timeoutMs);
    const unsubscribe = deps.subscribe((event) => {
      if (event.type === "commit.generated" && event.requestId === requestId) {
        settle({ ok: true, message: { subject: event.subject, body: event.body } });
      } else if (event.type === "commit.failed" && event.requestId === requestId) {
        settle({ ok: false, error: new Error(event.message) });
      }
    });
    stop = () => {
      clearTimeout(timer);
      unsubscribe();
    };
  });
  return { outcome, cancel: () => stop() };
}
