import type { BridgeEvent } from "@flare/protocol";

import type { OneShotDeps } from "../one-shot";
import { FakeQuery } from "./fake-query";
import { assistantMessage, resultMessage, textBlock } from "./sdk-messages";

export const ONE_SHOT_TEST_TIMEOUT_MS = 5_000;

export interface OneShotHarnessOptions {
  timeoutMs?: number;
  resolveClaudeExecutable?: () => string;
}

export function createOneShotHarness(options: OneShotHarnessOptions = {}) {
  const events: BridgeEvent[] = [];
  const logs: string[] = [];
  const queries: FakeQuery<string>[] = [];
  const deps: OneShotDeps = {
    createQuery: (params) => {
      const query = new FakeQuery<string>(params);
      queries.push(query);
      return query;
    },
    emit: (event) => events.push(event),
    resolveClaudeExecutable: options.resolveClaudeExecutable ?? (() => "claude.exe"),
    log: (line) => logs.push(line),
    timeoutMs: options.timeoutMs ?? ONE_SHOT_TEST_TIMEOUT_MS,
  };
  return { deps, events, logs, queries };
}

export function answer(query: FakeQuery<string> | undefined, text: string): void {
  query?.push(assistantMessage([textBlock(text)]));
  query?.push(resultMessage({ result: text }));
}
