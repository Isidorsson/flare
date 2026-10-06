import {
  BUILT_IN_OUTPUT_STYLES,
  effortSchema,
  outputStyleSchema,
  permissionModeSchema,
  type Effort,
  type PermissionMode,
} from "@flare/protocol";
import { z } from "zod";

export const MODEL_IDS = ["opus", "sonnet", "haiku"] as const;

export const modelSchema = z.enum(MODEL_IDS);

export const sessionSettingsSchema = z.object({
  model: modelSchema,
  effort: effortSchema,
  permissionMode: permissionModeSchema,
  outputStyle: outputStyleSchema,
});

export type Model = z.infer<typeof modelSchema>;
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  model: "opus",
  effort: "medium",
  permissionMode: "auto",
  outputStyle: "Concise",
};

export const MODEL_LABELS: Record<Model, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export const MODEL_DESCRIPTIONS: Record<Model, string> = {
  opus: "Most capable, best for hard problems",
  sonnet: "Balanced speed and capability for everyday work",
  haiku: "Fastest and lightest",
};

export const EFFORT_DESCRIPTIONS: Record<Effort, string> = {
  low: "Quick answers with minimal thinking",
  medium: "Balanced thinking for most tasks",
  high: "Thinks harder before it answers",
  xhigh: "Even deeper reasoning for hard tasks",
  max: "Deepest reasoning, slowest and most costly",
};

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  auto: "Auto",
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan only",
};

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  auto: "Claude approves routine actions itself and asks about risky ones",
  default: "Claude asks before it edits files or runs commands",
  acceptEdits: "File edits go through automatically; other actions still ask",
  plan: "Claude researches and proposes a plan without changing anything",
};

export function outputStyleLabel(name: string): string {
  return name === "default" ? "Default" : name;
}

/** Built-in styles keep their order; styles the CLI reports (e.g. custom ones) follow. */
export function mergeOutputStyles(known: readonly string[], available: readonly string[]): string[] {
  return [...new Set([...BUILT_IN_OUTPUT_STYLES, ...known, ...available])];
}
