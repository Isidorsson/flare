import type { BridgeEvent } from "@flare/protocol";

export interface CheckpointSinks {
  turnStarted: () => void;
  turnEnded: () => void;
}

/**
 * Routes bridge events to the checkpoint recorder: a snapshot when a turn starts and another when it
 * ends. A fatal error ends the turn too, because no `turn.completed` will follow it.
 */
export function createCheckpointRouter(sinks: CheckpointSinks): (event: BridgeEvent) => void {
  return (event) => {
    switch (event.type) {
      case "turn.started":
        sinks.turnStarted();
        return;
      case "turn.completed":
        sinks.turnEnded();
        return;
      case "error":
        if (event.fatal === true) sinks.turnEnded();
        return;
      default:
        return;
    }
  };
}
