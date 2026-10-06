import type { BridgeEvent } from "@flare/protocol";

export type AgentEventListener = (event: BridgeEvent) => void;

export interface AgentEventBus {
  subscribe(listener: AgentEventListener): () => void;
  publish(event: BridgeEvent): void;
}

export function createAgentEventBus(): AgentEventBus {
  const listeners = new Set<AgentEventListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.error(`flare: an agent event listener failed on ${event.type}`, error);
        }
      }
    },
  };
}

export const agentEvents = createAgentEventBus();

export function subscribeAgentEvents(listener: AgentEventListener): () => void {
  return agentEvents.subscribe(listener);
}
