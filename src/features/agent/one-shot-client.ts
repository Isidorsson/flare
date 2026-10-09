import type { AppMessage, BridgeEvent } from "@flare/protocol";

import type { AgentEventListener } from "./agent-events";

export interface OneShotClientDeps {
  send: (message: AppMessage) => Promise<void>;
  subscribe: (listener: AgentEventListener) => () => void;
  createId: () => string;
  timeoutMs: number;
}

export type Outcome<Result> = { ok: true; value: Result } | { ok: false; error: Error };

/** What differs between the things the bridge can write: the request, the matching reply and the wording. */
export interface OneShotProtocol<Input, Result> {
  // Names the product in messages: "commit message", "pull request description".
  noun: string;
  buildRequest: (requestId: string, input: Input) => AppMessage;
  // Reads the reply to `requestId` out of an event; undefined for every other event.
  interpret: (event: BridgeEvent, requestId: string) => Outcome<Result> | undefined;
}

interface PendingReply<Result> {
  // Never rejects, so a reply that lands while the request is still being sent cannot go unhandled.
  outcome: Promise<Outcome<Result>>;
  cancel: () => void;
}

/** Sends one request to the bridge and resolves with the reply that carries its request id. */
export function createOneShotClient<Input, Result>(
  deps: OneShotClientDeps,
  protocol: OneShotProtocol<Input, Result>,
): (input: Input) => Promise<Result> {
  return async (input) => {
    const requestId = deps.createId();
    const request = protocol.buildRequest(requestId, input);
    const reply = awaitReply(deps, protocol, requestId);
    try {
      await deps.send(request);
    } catch (error) {
      reply.cancel();
      throw error;
    }
    const outcome = await reply.outcome;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
}

function awaitReply<Input, Result>(
  deps: OneShotClientDeps,
  protocol: OneShotProtocol<Input, Result>,
  requestId: string,
): PendingReply<Result> {
  let stop: () => void = () => undefined;
  const outcome = new Promise<Outcome<Result>>((resolve) => {
    const settle = (result: Outcome<Result>) => {
      stop();
      resolve(result);
    };
    const timer = setTimeout(() => {
      const seconds = String(deps.timeoutMs / 1000);
      settle({ ok: false, error: new Error(`Timed out after ${seconds}s waiting for the ${protocol.noun}`) });
    }, deps.timeoutMs);
    const unsubscribe = deps.subscribe((event) => {
      const result = protocol.interpret(event, requestId);
      if (result !== undefined) settle(result);
    });
    stop = () => {
      clearTimeout(timer);
      unsubscribe();
    };
  });
  return { outcome, cancel: () => stop() };
}
