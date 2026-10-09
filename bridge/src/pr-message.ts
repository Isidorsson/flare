import { OneShotError, OneShotGenerator, type OneShotDeps } from "./one-shot";
import {
  buildPullRequestSystemPrompt,
  buildPullRequestUserPrompt,
  parseGeneratedPullRequest,
  type GeneratedPullRequest,
  type PullRequestRequest,
} from "./pr-message-format";

export type PullRequestGenerator = OneShotGenerator<PullRequestRequest, GeneratedPullRequest>;

export function createPullRequestGenerator(deps: OneShotDeps): PullRequestGenerator {
  return new OneShotGenerator(deps, {
    noun: "pull request description",
    validate: (request) => {
      if (request.commits.length === 0 && request.stat.trim() === "") {
        throw new OneShotError("There are no commits to describe.");
      }
    },
    systemPrompt: buildPullRequestSystemPrompt,
    userPrompt: buildPullRequestUserPrompt,
    parse: parseGeneratedPullRequest,
    succeeded: ({ requestId }, generated) => ({ type: "pr.generated", requestId, ...generated }),
    failed: ({ requestId }, message) => ({ type: "pr.failed", requestId, message }),
  });
}
