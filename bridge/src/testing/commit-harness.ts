import { createCommitMessageGenerator } from "../commit-message";
import type { CommitRequest } from "../commit-message-format";
import { createOneShotHarness, type OneShotHarnessOptions } from "./one-shot-harness";

export function commitRequest(overrides: Partial<CommitRequest> = {}): CommitRequest {
  return {
    type: "commit.generate",
    requestId: "c1",
    stat: " src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n",
    truncated: false,
    branch: null,
    recentSubjects: ["feat(chat): stream replies", "fix(graph): keep labels"],
    recentBodies: [],
    includeBody: false,
    ...overrides,
  };
}

export function createCommitHarness(options: OneShotHarnessOptions = {}) {
  const { deps, ...rest } = createOneShotHarness(options);
  return { generator: createCommitMessageGenerator(deps), ...rest };
}
