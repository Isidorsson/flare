import { Channel, invoke } from "@tauri-apps/api/core";

import { describeError } from "@/shared/lib/describe-error";

export interface BridgeTransport {
  start(onLine: (line: string) => void): Promise<void>;
  send(line: string): Promise<void>;
}

async function invokeBridge(command: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke<null>(command, args);
  } catch (error) {
    throw new Error(describeError(error), { cause: error });
  }
}

export function createTauriTransport(): BridgeTransport {
  return {
    start: (onLine) => {
      const channel = new Channel<string>();
      channel.onmessage = onLine;
      return invokeBridge("bridge_start", { onEvent: channel });
    },
    send: (line) => invokeBridge("bridge_send", { line }),
  };
}
