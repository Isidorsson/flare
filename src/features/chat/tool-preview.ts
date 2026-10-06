import type { ToolInput } from "@flare/protocol";

export const PREVIEW_MAX_CHARS = 140;

const PRIMARY_KEYS = ["command", "file_path", "notebook_path", "path", "pattern", "url", "query", "plan", "description"];

export function primaryInputText(input: ToolInput): string | null {
  for (const key of PRIMARY_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

export function previewToolInput(input: ToolInput): string {
  const text = primaryInputText(input);
  return text === null ? "" : oneLine(text);
}

export function formatToolInput(input: ToolInput): string {
  return JSON.stringify(input, null, 2);
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  return flat.length <= PREVIEW_MAX_CHARS ? flat : `${flat.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}
