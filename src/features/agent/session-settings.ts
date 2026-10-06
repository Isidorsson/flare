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

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  auto: "Auto",
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan only",
};

export function outputStyleLabel(name: string): string {
  return name === "default" ? "Default" : name;
}

/** Built-in styles keep their order; styles the CLI reports (e.g. custom ones) follow. */
export function mergeOutputStyles(known: readonly string[], available: readonly string[]): string[] {
  return [...new Set([...BUILT_IN_OUTPUT_STYLES, ...known, ...available])];
}
