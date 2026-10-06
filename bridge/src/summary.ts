export const MAX_SUMMARY_CHARS = 2000;

export type ToolResultContent = string | readonly { type: string; text?: string }[] | undefined;

export function summarizeToolResult(content: ToolResultContent): string {
  const text = typeof content === "string" ? content : (content ?? []).map(blockText).join("\n");
  return truncate(text.trim());
}

function blockText(block: { type: string; text?: string }): string {
  return block.type === "text" && block.text !== undefined ? block.text : `[${block.type}]`;
}

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n... (${text.length - MAX_SUMMARY_CHARS} more characters)`;
}
