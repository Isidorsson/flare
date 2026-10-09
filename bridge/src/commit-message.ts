import {
  buildSystemPrompt,
  buildUserPrompt,
  parseGeneratedMessage,
  type CommitRequest,
  type GeneratedMessage,
} from "./commit-message-format";
import { OneShotError, OneShotGenerator, type OneShotDeps } from "./one-shot";

export type CommitMessageGenerator = OneShotGenerator<CommitRequest, GeneratedMessage>;

export function createCommitMessageGenerator(deps: OneShotDeps): CommitMessageGenerator {
  return new OneShotGenerator(deps, {
    noun: "commit message",
    validate: (request) => {
      if (request.stat.trim() === "" && request.patch.trim() === "") {
        throw new OneShotError("There are no changes to describe.");
      }
    },
    systemPrompt: (request) => buildSystemPrompt(request.includeBody),
    userPrompt: buildUserPrompt,
    parse: (reply, request) => parseGeneratedMessage(reply, request.includeBody),
    succeeded: ({ requestId }, generated) => ({ type: "commit.generated", requestId, ...generated }),
    failed: ({ requestId }, message) => ({ type: "commit.failed", requestId, message }),
  });
}
