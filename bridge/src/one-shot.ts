import type { Options, SDKAssistantMessage, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { COMMIT_MESSAGE_MODEL, type BridgeEvent } from "@flare/protocol";

export class OneShotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OneShotError";
  }
}

export interface OneShotQuery extends AsyncIterable<SDKMessage> {
  close(): void;
}

export type OneShotQueryFactory = (params: { prompt: string; options: Options }) => OneShotQuery;

export interface OneShotDeps {
  createQuery: OneShotQueryFactory;
  emit: (event: BridgeEvent) => void;
  resolveClaudeExecutable: () => string;
  log: (line: string) => void;
  timeoutMs: number;
}

/** What differs between the things a one-shot query can write: the prompts, the parser and the events. */
export interface OneShotSpec<Request extends { requestId: string }, Result> {
  // Names the product in messages: "commit message", "pull request description".
  noun: string;
  // Throws a OneShotError when there is nothing to describe, before any query starts.
  validate: (request: Request) => void;
  systemPrompt: (request: Request) => string;
  userPrompt: (request: Request) => string;
  parse: (reply: string, request: Request) => Result;
  succeeded: (request: Request, result: Result) => BridgeEvent;
  failed: (request: Request, message: string) => BridgeEvent;
}

/**
 * Writes text with throwaway queries that share nothing with the chat session, so a request neither
 * needs a started session nor touches its queue or transcript.
 */
export class OneShotGenerator<Request extends { requestId: string }, Result> {
  readonly #deps: OneShotDeps;
  readonly #spec: OneShotSpec<Request, Result>;
  readonly #running = new Map<string, Promise<void>>();
  readonly #closers = new Set<() => void>();

  constructor(deps: OneShotDeps, spec: OneShotSpec<Request, Result>) {
    this.#deps = deps;
    this.#spec = spec;
  }

  request(message: Request): void {
    const { requestId } = message;
    if (this.#running.has(requestId)) {
      throw new Error(`Request ${requestId} for a ${this.#spec.noun} is already running`);
    }
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

  async #run(message: Request): Promise<void> {
    const { requestId } = message;
    try {
      const result = await this.#generate(message);
      this.#deps.emit(this.#spec.succeeded(message, result));
    } catch (error) {
      const reason = describeFailure(error, this.#spec.noun);
      this.#deps.log(`${this.#spec.noun} ${requestId} failed: ${reason}`);
      this.#deps.emit(this.#spec.failed(message, reason));
    }
  }

  async #generate(message: Request): Promise<Result> {
    this.#spec.validate(message);
    const query = this.#deps.createQuery({
      prompt: this.#spec.userPrompt(message),
      options: this.#buildOptions(message),
    });
    let closed = false;
    const closeQuery = () => {
      if (closed) return;
      closed = true;
      query.close();
    };
    this.#closers.add(closeQuery);
    try {
      const reply = await withTimeout(collectReply(query, this.#spec.noun), this.#deps.timeoutMs, this.#spec.noun);
      return this.#spec.parse(reply, message);
    } finally {
      this.#closers.delete(closeQuery);
      closeQuery();
    }
  }

  #buildOptions(message: Request): Options {
    return {
      model: COMMIT_MESSAGE_MODEL,
      pathToClaudeCodeExecutable: this.#deps.resolveClaudeExecutable(),
      systemPrompt: this.#spec.systemPrompt(message),
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
async function withTimeout(work: Promise<string>, timeoutMs: number, noun: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new OneShotError(`Claude took longer than ${String(timeoutMs / 1000)}s to write a ${noun}.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(error: unknown, noun: string): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason === "" ? `Generating a ${noun} failed.` : reason;
}

async function collectReply(query: AsyncIterable<SDKMessage>, noun: string): Promise<string> {
  let assistantText = "";
  for await (const message of query) {
    if (message.type === "assistant") assistantText = textOf(message);
    if (message.type === "result") return resultText(message, assistantText, noun);
  }
  if (assistantText !== "") return assistantText;
  throw new OneShotError(`Claude ended without writing a ${noun}.`);
}

function textOf(message: SDKAssistantMessage): string {
  let text = "";
  for (const block of message.message.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

function resultText(result: SDKResultMessage, assistantText: string, noun: string): string {
  if (result.subtype !== "success") {
    const reasons = result.errors.length > 0 ? result.errors.join("; ") : result.subtype;
    throw new OneShotError(`Claude could not write a ${noun}: ${reasons}`);
  }
  if (result.is_error) {
    throw new OneShotError(result.result === "" ? "Claude reported an error." : result.result);
  }
  return result.result.trim() === "" ? assistantText : result.result;
}
