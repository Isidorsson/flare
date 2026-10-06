import { resolve } from "node:path";

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeEvent } from "@flare/protocol";

import { MessageNormalizer } from "../normalize";
import { createFakeFs } from "./fake-fs";
import { SESSION_ID } from "./sdk-messages";

export const CWD = resolve("/work/app");
export const FILE = resolve(CWD, "src/a.ts");

export function setupNormalizer(files: Record<string, string> = {}) {
  const fs = createFakeFs(files);
  const clock = { now: 1_000 };
  const normalizer = new MessageNormalizer({
    sessionId: SESSION_ID,
    cwd: CWD,
    readText: fs.readText,
    now: () => clock.now,
  });
  async function runAll(...messages: SDKMessage[]): Promise<BridgeEvent[]> {
    const events: BridgeEvent[] = [];
    for (const message of messages) events.push(...(await normalizer.normalize(message)));
    return events;
  }
  // Most tests are about what a message turns into, so the turn.started that the first message opens is left out.
  async function run(...messages: SDKMessage[]): Promise<BridgeEvent[]> {
    return (await runAll(...messages)).filter((event) => event.type !== "turn.started");
  }
  return { fs, normalizer, run, runAll, clock };
}
