import type { PullRequestRequest } from "../pr-message-format";
import { createPullRequestGenerator } from "../pr-message";
import { createOneShotHarness, type OneShotHarnessOptions } from "./one-shot-harness";

export function pullRequestRequest(overrides: Partial<PullRequestRequest> = {}): PullRequestRequest {
  return {
    type: "pr.generate",
    requestId: "p1",
    branch: "feat/login",
    base: "main",
    commits: [
      { subject: "feat(auth): add the login form", body: "" },
      { subject: "fix(auth): trim the email", body: "Pasted addresses kept a trailing space." },
    ],
    stat: " src/login.ts | 10 ++++\n src/login.test.ts | 6 ++\n 2 files changed, 16 insertions(+)",
    truncated: false,
    ...overrides,
  };
}

export function createPullRequestHarness(options: OneShotHarnessOptions = {}) {
  const { deps, ...rest } = createOneShotHarness(options);
  return { generator: createPullRequestGenerator(deps), ...rest };
}
