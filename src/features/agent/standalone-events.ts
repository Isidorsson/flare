import type { BridgeEvent, BridgeEventOf } from "@flare/protocol";

export type StandaloneEvent = BridgeEventOf<"commit.generated" | "commit.failed" | "pr.generated" | "pr.failed">;

/** Answers to standalone requests belong to no thread; their requester listens on the event bus. */
export function isStandaloneEvent(event: BridgeEvent): event is StandaloneEvent {
  return (
    event.type === "commit.generated" ||
    event.type === "commit.failed" ||
    event.type === "pr.generated" ||
    event.type === "pr.failed"
  );
}
