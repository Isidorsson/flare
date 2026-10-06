import type { ActivityKind } from "./activity-types";
import { parseHex } from "./color-math";
import type { ReadToken } from "./palette";

export const ACTIVITY_TOKENS = {
  read: "--color-activity-read",
  edit: "--color-activity-edit",
  create: "--color-activity-create",
  finish: "--color-activity-finish",
  agent: "--color-agent",
} as const;

export type ActivityPalette = Readonly<Record<keyof typeof ACTIVITY_TOKENS, string>>;

function pick(read: ReadToken, name: string): string {
  const value = read(name).trim();
  if (value === "") throw new Error(`design token ${name} is not defined`);
  parseHex(value);
  return value;
}

export function readActivityPalette(read: ReadToken): ActivityPalette {
  return {
    read: pick(read, ACTIVITY_TOKENS.read),
    edit: pick(read, ACTIVITY_TOKENS.edit),
    create: pick(read, ACTIVITY_TOKENS.create),
    finish: pick(read, ACTIVITY_TOKENS.finish),
    agent: pick(read, ACTIVITY_TOKENS.agent),
  };
}

export function activityColor(palette: ActivityPalette, kind: ActivityKind): string {
  switch (kind) {
    case "read":
    case "search":
      return palette.read;
    case "edit":
      return palette.edit;
    case "create":
      return palette.create;
    case "run":
      return palette.agent;
  }
}
