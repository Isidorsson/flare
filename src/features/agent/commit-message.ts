import { createCommitMessageClient } from "./commit-message-client";
import { oneShotClientDeps } from "./one-shot-deps";

export type { CommitMessage, CommitMessageInput, GenerateCommitMessage } from "./commit-message-client";

export const generateCommitMessage = createCommitMessageClient(oneShotClientDeps);
