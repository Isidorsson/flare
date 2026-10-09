import type { z } from "zod";

const FENCED_BLOCK = /```[\w-]*[ \t]*\r?\n([\s\S]*?)```/;
const TRAILER_LINE = /^\s*(?:🤖|(?:co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by|generated (?:with|by))\b)/i;
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["“", "”"],
  ["‘", "’"],
];

export function unfence(text: string): string {
  return (FENCED_BLOCK.exec(text)?.[1] ?? text).trim();
}

/** Models pad or wrap the JSON in chatter or a fence, so the reply is probed in a few shapes. */
export function findJsonReply<T>(text: string, schema: z.ZodType<T>): T | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidates = [text, FENCED_BLOCK.exec(text)?.[1], start >= 0 && end > start ? text.slice(start, end + 1) : undefined];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const reply = schema.safeParse(parseJson(candidate.trim()));
    if (reply.success) return reply.data;
  }
  return undefined;
}

// Probing text that is not JSON is expected to fail.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The first line and the rest of a reply that ignored the JSON format; undefined when it looks like broken JSON. */
export function splitPlainReply(text: string): { head: string; rest: string } | undefined {
  const [head = "", ...rest] = unfence(text).split(/\r?\n/);
  if (/^[{[]/.test(head.trim())) return undefined;
  return { head, rest: rest.join("\n") };
}

export function cleanHeadline(raw: string, label: RegExp): string {
  const firstLine = raw.trim().split(/\r?\n/, 1)[0] ?? "";
  return stripWrappers(firstLine.replace(label, "")).replace(/\s+/g, " ");
}

function stripWrappers(text: string): string {
  let current = text.trim();
  for (;;) {
    const next = unwrapQuotes(current).replace(/\.+$/, "").trim();
    if (next === current) return next;
    current = next;
  }
}

function unwrapQuotes(text: string): string {
  const wrapped = QUOTE_PAIRS.some(([open, close]) => text.length >= 2 && text.startsWith(open) && text.endsWith(close));
  return wrapped ? text.slice(1, -1).trim() : text;
}

export function removeTrailers(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !TRAILER_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
