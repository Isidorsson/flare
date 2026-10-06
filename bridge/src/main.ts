import { query } from "@anthropic-ai/claude-agent-sdk";
import { encodeLine, type BridgeEvent } from "@flare/protocol";

import { resolveClaudeExecutable } from "./claude-executable";
import { runCommandLoop } from "./commands";
import { readTextFile } from "./read-text-file";
import { AgentSession } from "./session";

function emit(event: BridgeEvent): void {
  process.stdout.write(encodeLine(event));
}

function log(line: string): void {
  process.stderr.write(`${line.trimEnd()}\n`);
}

async function main(): Promise<void> {
  const session = new AgentSession({
    createQuery: query,
    emit,
    readText: readTextFile,
    resolveClaudeExecutable: () => resolveClaudeExecutable(process.env, (command) => Bun.which(command)),
    createSessionId: () => crypto.randomUUID(),
    log,
  });
  try {
    await runCommandLoop(Bun.stdin.stream(), session, emit);
  } finally {
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
