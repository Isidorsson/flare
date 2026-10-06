const PROMPT_MAX_CHARS = 56;

/** Wall-clock time of day, in the viewer's locale. */
export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A prompt squeezed onto one line for a list row. */
export function oneLine(text: string, maxChars = PROMPT_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`;
}
