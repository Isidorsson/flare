import { commitGenerateSchema, MAX_COMMIT_RECENT_BODIES, MAX_COMMIT_RECENT_SUBJECTS } from "@flare/protocol";

import { createOneShotClient, type OneShotClientDeps } from "./one-shot-client";

export interface CommitMessageInput {
  stat: string;
  patch: string;
  truncated: boolean;
  // Null or absent when HEAD is detached or the branch is not known.
  branch?: string | null;
  recentSubjects: string[];
  recentBodies?: string[];
  includeBody: boolean;
}

export interface CommitMessage {
  subject: string;
  body: string | null;
}

export type GenerateCommitMessage = (input: CommitMessageInput) => Promise<CommitMessage>;

export function createCommitMessageClient(deps: OneShotClientDeps): GenerateCommitMessage {
  return createOneShotClient<CommitMessageInput, CommitMessage>(deps, {
    noun: "commit message",
    buildRequest: (requestId, input) =>
      commitGenerateSchema.parse({
        type: "commit.generate",
        requestId,
        ...input,
        branch: input.branch ?? null,
        recentSubjects: input.recentSubjects.slice(0, MAX_COMMIT_RECENT_SUBJECTS),
        recentBodies: (input.recentBodies ?? []).slice(0, MAX_COMMIT_RECENT_BODIES),
      }),
    interpret: (event, requestId) => {
      if (event.type === "commit.generated" && event.requestId === requestId) {
        return { ok: true, value: { subject: event.subject, body: event.body } };
      }
      if (event.type === "commit.failed" && event.requestId === requestId) {
        return { ok: false, error: new Error(event.message) };
      }
      return undefined;
    },
  });
}
