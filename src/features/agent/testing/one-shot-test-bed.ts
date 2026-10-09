import type { AppMessage } from "@flare/protocol";

import { createAgentEventBus, type AgentEventBus } from "../agent-events";
import type { OneShotClientDeps } from "../one-shot-client";

export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** In-memory deps for a one-shot client: records what is sent, counts live listeners, numbers the request ids. */
export function createOneShotTestBed(overrides: Partial<OneShotClientDeps> = {}) {
  const bus: AgentEventBus = createAgentEventBus();
  const sent: AppMessage[] = [];
  let listeners = 0;
  let ids = 0;
  const deps: OneShotClientDeps = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    subscribe: (listener) => {
      listeners += 1;
      const unsubscribe = bus.subscribe(listener);
      return () => {
        listeners -= 1;
        unsubscribe();
      };
    },
    createId: () => `req-${String((ids += 1))}`,
    timeoutMs: 5_000,
    ...overrides,
  };
  return { deps, bus, sent, listeners: () => listeners };
}
