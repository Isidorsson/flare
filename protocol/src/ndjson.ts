import { z } from "zod";

import { appMessageSchema, type AppMessage } from "./app-messages";
import { bridgeEventSchema, type BridgeEvent } from "./bridge-events";

const LINE_PREVIEW_CHARS = 200;

export class ProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProtocolError";
  }
}

export function encodeLine(message: AppMessage | BridgeEvent): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseAppMessage(line: string): AppMessage {
  return parseLine(appMessageSchema, line);
}

export function parseBridgeEvent(line: string): BridgeEvent {
  return parseLine(bridgeEventSchema, line);
}

export interface SplitLines {
  lines: string[];
  rest: string;
}

export function splitLines(buffered: string, chunk: string): SplitLines {
  const parts = (buffered + chunk).split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts.map((part) => part.replace(/\r$/, "")).filter((part) => part.length > 0);
  return { lines, rest };
}

function parseLine<S extends z.ZodType>(schema: S, line: string): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (cause) {
    throw new ProtocolError(`Not valid JSON: ${preview(line)}`, { cause });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ProtocolError(`${z.prettifyError(parsed.error)} in ${preview(line)}`, { cause: parsed.error });
  }
  return parsed.data;
}

function preview(line: string): string {
  return line.length <= LINE_PREVIEW_CHARS ? line : `${line.slice(0, LINE_PREVIEW_CHARS)}...`;
}
