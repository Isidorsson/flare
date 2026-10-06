import { parseAppMessage, splitLines, type AppMessage, type BridgeEvent } from "@flare/protocol";

import type { AgentSession } from "./session";

type Emit = (event: BridgeEvent) => void;

export async function handleCommand(session: AgentSession, message: AppMessage): Promise<void> {
  switch (message.type) {
    case "session.start":
      session.start(message);
      return;
    case "user.message":
      session.sendUserMessage(message.text);
      return;
    case "permission.respond":
      session.respondToPermission(message.requestId, message.decision);
      return;
    case "interrupt":
      await session.interrupt();
      return;
    case "session.setModel":
      await session.setModel(message.model);
      return;
    case "session.setEffort":
      await session.setEffort(message.effort);
      return;
    case "session.setPermissionMode":
      await session.setPermissionMode(message.permissionMode);
      return;
  }
}

export async function processLine(line: string, session: AgentSession, emit: Emit): Promise<void> {
  let message: AppMessage | null = null;
  try {
    message = parseAppMessage(line);
    await handleCommand(session, message);
  } catch (error) {
    emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      fatal: message?.type === "session.start",
    });
  }
}

export async function runCommandLoop(
  chunks: AsyncIterable<Uint8Array>,
  session: AgentSession,
  emit: Emit,
): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of chunks) {
    const split = splitLines(rest, decoder.decode(chunk, { stream: true }));
    rest = split.rest;
    for (const line of split.lines) await processLine(line, session, emit);
  }
  for (const line of splitLines(rest, `${decoder.decode()}\n`).lines) await processLine(line, session, emit);
}
