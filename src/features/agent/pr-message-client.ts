import { prGenerateSchema, type PrCommit } from "@flare/protocol";

import { createOneShotClient, type OneShotClientDeps } from "./one-shot-client";

export interface PullRequestInput {
  branch: string;
  base: string;
  // Oldest first.
  commits: PrCommit[];
  stat: string;
  truncated: boolean;
}

export interface PullRequestMessage {
  title: string;
  body: string;
}

export type GeneratePullRequest = (input: PullRequestInput) => Promise<PullRequestMessage>;

export function createPullRequestClient(deps: OneShotClientDeps): GeneratePullRequest {
  return createOneShotClient<PullRequestInput, PullRequestMessage>(deps, {
    noun: "pull request description",
    buildRequest: (requestId, input) => prGenerateSchema.parse({ type: "pr.generate", requestId, ...input }),
    interpret: (event, requestId) => {
      if (event.type === "pr.generated" && event.requestId === requestId) {
        return { ok: true, value: { title: event.title, body: event.body } };
      }
      if (event.type === "pr.failed" && event.requestId === requestId) {
        return { ok: false, error: new Error(event.message) };
      }
      return undefined;
    },
  });
}
