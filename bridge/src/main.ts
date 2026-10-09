import { query } from "@anthropic-ai/claude-agent-sdk";
import { ONE_SHOT_BRIDGE_TIMEOUT_MS, encodeLine, type BridgeEvent } from "@flare/protocol";

import { resolveClaudeExecutable } from "./claude-executable";
import { createCommitMessageGenerator } from "./commit-message";
import { runCommandLoop } from "./commands";
import { createPullRequestGenerator } from "./pr-message";
import { readTextFile } from "./read-text-file";
import { AgentSession } from "./session";

function emit(event: BridgeEvent): void {
  process.stdout.write(encodeLine(event));
}

function log(line: string): void {
  process.stderr.write(`${line.trimEnd()}\n`);
}

function findClaudeExecutable(): string {
  return resolveClaudeExecutable(process.env, (command) => Bun.which(command));
}

async function main(): Promise<void> {
  const session = new AgentSession({
    createQuery: query,
    emit,
    readText: readTextFile,
    resolveClaudeExecutable: findClaudeExecutable,
    createSessionId: () => crypto.randomUUID(),
    log,
  });
  const oneShotDeps = {
    createQuery: query,
    emit,
    resolveClaudeExecutable: findClaudeExecutable,
    log,
    timeoutMs: ONE_SHOT_BRIDGE_TIMEOUT_MS,
  };
  const commitMessages = createCommitMessageGenerator(oneShotDeps);
  const pullRequests = createPullRequestGenerator(oneShotDeps);
  try {
    await runCommandLoop(Bun.stdin.stream(), { session, commitMessages, pullRequests }, emit);
  } finally {
    pullRequests.close();
    commitMessages.close();
    session.close();
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    log(`flare-bridge crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  },
);
