import { oneShotClientDeps } from "./one-shot-deps";
import { createPullRequestClient } from "./pr-message-client";

export type { GeneratePullRequest, PullRequestInput, PullRequestMessage } from "./pr-message-client";

export const generatePullRequest = createPullRequestClient(oneShotClientDeps);
