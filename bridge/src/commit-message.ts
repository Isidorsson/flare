import type { Options, SDKAssistantMessage, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { COMMIT_MESSAGE_MODEL, type BridgeEvent } from "@flare/protocol";

import {
  buildSystemPrompt,
  buildUserPrompt,
  CommitMessageError,
  parseGeneratedMessage,
  type CommitRequest,
  type GeneratedMessage,
} from "./commit-message-format";

export interface OneShotQuery extends AsyncIterable<SDKMessage> {
  close(): void;
}

export type OneShotQueryFactory = (params: { prompt: string; options: Options }) => OneShotQuery;

export interface CommitMessageDeps {
  createQuery: OneShotQueryFactory;
  emit: (event: BridgeEvent) => void;
  resolveClaudeExecutable: () => string;
  log: (line: string) => void;
  timeoutMs: number;
}

/**
 * Writes commit messages with throwaway queries that share nothing with the chat session, so a
 * request neither needs a started session nor touches its queue or transcript.
 */
export class CommitMessageGenerator {
  readonly #deps: CommitMessageDeps;
  readonly #running = new Map<string, Promise<void>>();
  readonly #closers = new Set<() => void>();

  constructor(deps: CommitMessageDeps) {
    this.#deps = deps;
  }

  request(message: CommitRequest): void {
    const { requestId } = message;
    if (this.#running.has(requestId)) throw new Error(`Commit message request ${requestId} is already running`);
    this.#running.set(
      requestId,
      this.#run(message).finally(() => {
        this.#running.delete(requestId);
      }),
    );
  }

  settled(): Promise<void> {
    return Promise.all(this.#running.values()).then(() => undefined);
  }

  close(): void {
    for (const closeQuery of [...this.#closers]) closeQuery();
  }

  async #run(message: CommitRequest): Promise<void> {
    const { requestId } = message;
    try {
      const generated = await this.#generate(message);
      this.#deps.emit({ type: "commit.generated", requestId, ...generated });
    } catch (error) {
      const reason = describeFailure(error);
      this.#deps.log(`commit message ${requestId} failed: ${reason}`);
      this.#deps.emit({ type: "commit.failed", requestId, message: reason });
    }
  }

  async #generate(message: CommitRequest): Promise<GeneratedMessage> {
    if (message.stat.trim() === "" && message.patch.trim() === "") {
      throw new CommitMessageError("There are no changes to describe.");
    }
    const query = this.#deps.createQuery({
      prompt: buildUserPrompt(message),
      options: this.#buildOptions(message.includeBody),
    });
    let closed = false;
    const closeQuery = () => {
      if (closed) return;
      closed = true;
      query.close();
    };
    this.#closers.add(closeQuery);
    try {
      const reply = await withTimeout(collectReply(query), this.#deps.timeoutMs);
      return parseGeneratedMessage(reply, message.includeBody);
    } finally {
      this.#closers.delete(closeQuery);
      closeQuery();
    }
  }

  #buildOptions(includeBody: boolean): Options {
    return {
      model: COMMIT_MESSAGE_MODEL,
      pathToClaudeCodeExecutable: this.#deps.resolveClaudeExecutable(),
      systemPrompt: buildSystemPrompt(includeBody),
      tools: [],
      permissionMode: "dontAsk",
      maxTurns: 1,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      thinking: { type: "disabled" },
      stderr: this.#deps.log,
    };
  }
}

// A reply that arrives after the deadline settles the raced promise harmlessly: `race` has already handled it.
async function withTimeout(work: Promise<string>, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new CommitMessageError(`Claude took longer than ${String(timeoutMs / 1000)}s to write a commit message.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason === "" ? "Commit message generation failed." : reason;
}

async function collectReply(query: AsyncIterable<SDKMessage>): Promise<string> {
  let assistantText = "";
  for await (const message of query) {
    if (message.type === "assistant") assistantText = textOf(message);
    if (message.type === "result") return resultText(message, assistantText);
  }
  if (assistantText !== "") return assistantText;
  throw new CommitMessageError("Claude ended without writing a commit message.");
}

function textOf(message: SDKAssistantMessage): string {
  let text = "";
  for (const block of message.message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

function resultText(result: SDKResultMessage, assistantText: string): string {
  if (result.subtype !== "success") {
    const reasons = result.errors.length > 0 ? result.errors.join("; ") : result.subtype;
    throw new CommitMessageError(`Claude could not write a commit message: ${reasons}`);
  }
  if (result.is_error) {
    throw new CommitMessageError(result.result === "" ? "Claude reported an error." : result.result);
  }
  return result.result.trim() === "" ? assistantText : result.result;
}
