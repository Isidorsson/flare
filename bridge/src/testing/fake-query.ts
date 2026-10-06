import type { Options, PermissionMode, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Effort } from "@flare/protocol";

import { AsyncQueue } from "../queue";
import type { AgentQuery } from "../session";

export interface QueryParams {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}

export class FakeQuery implements AgentQuery {
  readonly calls: string[] = [];
  readonly params: QueryParams;
  readonly #messages = new AsyncQueue<SDKMessage>();
  #failure: Error | null = null;

  constructor(params: QueryParams) {
    this.params = params;
  }

  push(message: SDKMessage): void {
    this.#messages.push(message);
  }

  end(): void {
    this.#messages.close();
  }

  fail(error: Error): void {
    this.#failure = error;
    this.#messages.close();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    for await (const message of this.#messages) yield message;
    if (this.#failure) throw this.#failure;
  }

  interrupt(): Promise<unknown> {
    this.calls.push("interrupt");
    return Promise.resolve();
  }

  setModel(model: string): Promise<void> {
    this.calls.push(`setModel:${model}`);
    return Promise.resolve();
  }

  setPermissionMode(mode: PermissionMode): Promise<void> {
    this.calls.push(`setPermissionMode:${mode}`);
    return Promise.resolve();
  }

  applyFlagSettings(settings: { effortLevel: Effort }): Promise<void> {
    this.calls.push(`effort:${settings.effortLevel}`);
    return Promise.resolve();
  }

  close(): void {
    this.calls.push("close");
  }
}
