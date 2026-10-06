export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };
export type PathKey = string | number;

export interface PartialJson {
  value: JsonValue | undefined;
  // Where the string that was cut off by the end of the input sits, or null when no string is mid-way.
  openString: readonly PathKey[] | null;
}

interface Cursor {
  text: string;
  pos: number;
  openString: readonly PathKey[] | null;
}

type Parsed = { done: true; value: JsonValue } | { done: false; value: JsonValue | undefined };

const WHITESPACE = new Set([" ", "\n", "\r", "\t"]);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
const HEX4 = /^[0-9a-fA-F]{4}$/;
const LITERALS: Readonly<Record<string, JsonValue>> = { true: true, false: false, null: null };

/**
 * Reads JSON that may stop anywhere, such as the tool input a model is still
 * streaming. Whatever is complete comes back as a normal value, a string that
 * was cut off keeps the text received so far, and a dangling key, escape or
 * literal is dropped. Parsing the whole text again on every chunk keeps the
 * result correct however the chunks were split.
 */
export function parsePartialJson(text: string): PartialJson {
  const cursor: Cursor = { text, pos: 0, openString: null };
  const parsed = parseValue(cursor, []);
  return { value: parsed.value, openString: cursor.openString };
}

export function valueAt(root: JsonValue | undefined, path: readonly PathKey[]): JsonValue | undefined {
  let current = root;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
      current = Object.hasOwn(current, key) ? current[key] : undefined;
    }
  }
  return current;
}

export function isSamePath(a: readonly PathKey[] | null, b: readonly PathKey[]): boolean {
  return a !== null && a.length === b.length && a.every((key, index) => key === b[index]);
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && WHITESPACE.has(cursor.text.charAt(cursor.pos))) cursor.pos += 1;
}

function parseValue(cursor: Cursor, path: readonly PathKey[]): Parsed {
  skipWhitespace(cursor);
  const char = cursor.text.charAt(cursor.pos);
  if (char === "") return { done: false, value: undefined };
  if (char === '"') return parseString(cursor, path);
  if (char === "{") return parseObject(cursor, path);
  if (char === "[") return parseArray(cursor, path);
  return parseLiteral(cursor);
}

function parseLiteral(cursor: Cursor): Parsed {
  const start = cursor.pos;
  while (cursor.pos < cursor.text.length && !isDelimiter(cursor.text.charAt(cursor.pos))) cursor.pos += 1;
  const token = cursor.text.slice(start, cursor.pos);
  const atEnd = cursor.pos >= cursor.text.length;
  const literal = Object.hasOwn(LITERALS, token) ? LITERALS[token] : undefined;
  if (literal !== undefined) return { done: true, value: literal };
  const number = Number(token);
  if (token === "" || !Number.isFinite(number)) return { done: false, value: undefined };
  // A number at the very end may still be growing, so it is not trusted yet.
  return atEnd ? { done: false, value: number } : { done: true, value: number };
}

function isDelimiter(char: string): boolean {
  return char === "," || char === "}" || char === "]" || WHITESPACE.has(char);
}

function parseObject(cursor: Cursor, path: readonly PathKey[]): Parsed {
  const result: Record<string, JsonValue> = {};
  cursor.pos += 1;
  for (;;) {
    skipWhitespace(cursor);
    if (cursor.text.charAt(cursor.pos) === "}") {
      cursor.pos += 1;
      return { done: true, value: result };
    }
    const key = parseKey(cursor);
    if (key === null) return { done: false, value: result };
    const entry = parseValue(cursor, [...path, key]);
    if (entry.value !== undefined) result[key] = entry.value;
    if (!entry.done) return { done: false, value: result };
    skipComma(cursor);
  }
}

function parseKey(cursor: Cursor): string | null {
  if (cursor.text.charAt(cursor.pos) !== '"') return null;
  const probe: Cursor = { text: cursor.text, pos: cursor.pos, openString: null };
  const key = parseString(probe, []);
  if (!key.done || typeof key.value !== "string") return null;
  cursor.pos = probe.pos;
  return consumeSeparator(cursor, ":") ? key.value : null;
}

function consumeSeparator(cursor: Cursor, separator: string): boolean {
  skipWhitespace(cursor);
  if (cursor.text.charAt(cursor.pos) !== separator) return false;
  cursor.pos += 1;
  return true;
}

function skipComma(cursor: Cursor): void {
  skipWhitespace(cursor);
  if (cursor.text.charAt(cursor.pos) === ",") cursor.pos += 1;
}

function parseArray(cursor: Cursor, path: readonly PathKey[]): Parsed {
  const result: JsonValue[] = [];
  cursor.pos += 1;
  for (;;) {
    skipWhitespace(cursor);
    if (cursor.text.charAt(cursor.pos) === "]") {
      cursor.pos += 1;
      return { done: true, value: result };
    }
    const item = parseValue(cursor, [...path, result.length]);
    if (item.value !== undefined) result.push(item.value);
    if (!item.done) return { done: false, value: result };
    skipComma(cursor);
  }
}

function parseString(cursor: Cursor, path: readonly PathKey[]): Parsed {
  const { text } = cursor;
  let out = "";
  let pos = cursor.pos + 1;
  for (;;) {
    const stop = findStringStop(text, pos);
    out += text.slice(pos, stop);
    pos = stop;
    const char = text.charAt(pos);
    if (char === '"') {
      cursor.pos = pos + 1;
      return { done: true, value: out };
    }
    const escape = char === "" ? null : readEscape(text, pos);
    if (escape === null) {
      cursor.pos = text.length;
      cursor.openString = path;
      return { done: false, value: dropLoneHighSurrogate(out) };
    }
    out += escape.text;
    pos = escape.next;
  }
}

function findStringStop(text: string, from: number): number {
  for (let pos = from; pos < text.length; pos += 1) {
    const char = text.charAt(pos);
    if (char === '"' || char === "\\") return pos;
  }
  return text.length;
}

interface Escape {
  text: string;
  next: number;
}

// Returns null when the escape is cut off by the end of the input.
function readEscape(text: string, backslash: number): Escape | null {
  const code = text.charAt(backslash + 1);
  if (code === "") return null;
  if (code === "u") {
    const hex = text.slice(backslash + 2, backslash + 6);
    if (!HEX4.test(hex)) return null;
    return { text: String.fromCharCode(Number.parseInt(hex, 16)), next: backslash + 6 };
  }
  return { text: SIMPLE_ESCAPES[code] ?? code, next: backslash + 2 };
}

function dropLoneHighSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}
