import type { BridgeEvent } from "@flare/protocol";

import { CommitMessageGenerator } from "../commit-message";
import type { CommitRequest } from "../commit-message-format";
import { FakeQuery } from "./fake-query";

export const COMMIT_TEST_TIMEOUT_MS = 5_000;

export function commitRequest(overrides: Partial<CommitRequest> = {}): CommitRequest {
  return {
    type: "commit.generate",
    requestId: "c1",
    stat: " src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n",
    truncated: false,
    recentSubjects: ["feat(chat): stream replies", "fix(graph): keep labels"],
    includeBody: false,
    ...overrides,
  };
}

interface HarnessOptions {
  timeoutMs?: number;
  resolveClaudeExecutable?: () => string;
}

export function createCommitHarness(options: HarnessOptions = {}) {
  const events: BridgeEvent[] = [];
  const logs: string[] = [];
  const queries: FakeQuery<string>[] = [];
  const generator = new CommitMessageGenerator({
    createQuery: (params) => {
      const query = new FakeQuery<string>(params);
      queries.push(query);
      return query;
    },
    emit: (event) => events.push(event),
    resolveClaudeExecutable: options.resolveClaudeExecutable ?? (() => "claude.exe"),
    log: (line) => logs.push(line),
    timeoutMs: options.timeoutMs ?? COMMIT_TEST_TIMEOUT_MS,
  });
  return { generator, events, logs, queries };
}
