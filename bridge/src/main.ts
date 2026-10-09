import { query } from "@anthropic-ai/claude-agent-sdk";
import { COMMIT_MESSAGE_BRIDGE_TIMEOUT_MS, encodeLine, type BridgeEvent } from "@flare/protocol";

import { resolveClaudeExecutable } from "./claude-executable";
import { CommitMessageGenerator } from "./commit-message";
import { runCommandLoop } from "./commands";
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
  const commitMessages = new CommitMessageGenerator({
    createQuery: query,
    emit,
    resolveClaudeExecutable: findClaudeExecutable,
    log,
    timeoutMs: COMMIT_MESSAGE_BRIDGE_TIMEOUT_MS,
  });
  try {
    await runCommandLoop(Bun.stdin.stream(), { session, commitMessages }, emit);
  } finally {
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
