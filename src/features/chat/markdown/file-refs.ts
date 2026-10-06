export interface FileTarget {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

export type TextSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly text: string; readonly target: FileTarget };

// Extensions that make a bare name such as `Cargo.toml` read as a file rather than as `obj.method`.
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "jsonc", "md", "mdx", "rs", "toml", "py", "go",
  "java", "kt", "kts", "cs", "cpp", "cc", "c", "h", "hpp", "rb", "php", "dart", "zig", "lua", "luau", "swift",
  "css", "scss", "less", "html", "vue", "svelte", "yml", "yaml", "lock", "txt", "sh", "ps1", "bat", "sql", "xml",
  "env", "ini", "cfg", "csv", "svg", "gradle", "proto", "graphql", "prisma",
]);

const NAME = String.raw`[\w.@+~-]`;
const PATH = String.raw`(?:[A-Za-z]:[\\/]|[\\/])?(?:${NAME}+[\\/])*${NAME}*\w\.([A-Za-z][A-Za-z0-9]{0,9})`;
const POSITION = String.raw`(?::(\d+)(?::(\d+))?|#L(\d+))?`;
const EXACT = new RegExp(`^(${PATH})${POSITION}$`);
const IN_TEXT = new RegExp(String.raw`(?<![\w.@~+/\\:-])(${PATH})${POSITION}(?![\w/\\])`, "g");

function positiveInteger(digits: string | undefined): number | null {
  if (digits === undefined) return null;
  const value = Number(digits);
  return value > 0 ? value : null;
}

function targetFrom(groups: readonly (string | undefined)[]): FileTarget | null {
  const [path, , line, column, hashLine] = groups;
  if (path === undefined || path.startsWith("//") || path.startsWith("\\\\")) return null;
  return { path, line: positiveInteger(line ?? hashLine), column: positiveInteger(column) };
}

const hasSeparator = (path: string): boolean => path.includes("/") || path.includes("\\");

/** A path that a link points at, with an optional `:line`, `:line:column` or `#L12` suffix. Any extension will do. */
export function parseFileDestination(text: string): FileTarget | null {
  const match = EXACT.exec(text);
  return match === null ? null : targetFrom(match.slice(1));
}

/** The text of an inline code span, when all of it names a file: `src/a.ts:42`, or a bare `Cargo.toml`. */
export function parseFileReference(code: string): FileTarget | null {
  const match = EXACT.exec(code);
  const target = match === null ? null : targetFrom(match.slice(1));
  if (target === null) return null;
  const extension = match?.[2]?.toLowerCase() ?? "";
  return hasSeparator(target.path) || target.line !== null || KNOWN_EXTENSIONS.has(extension) ? target : null;
}

/**
 * Finds file references in running prose. Prose is picky, because `Node.js` and `e.g.` are not files: a name needs
 * a folder in front of it (`src/a.ts`) or a line behind it (`a.ts:42`).
 */
export function splitFileReferences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let consumed = 0;
  for (const match of text.matchAll(IN_TEXT)) {
    const target = targetFrom(match.slice(1));
    if (target === null || !(hasSeparator(target.path) || target.line !== null)) continue;
    if (match.index > consumed) segments.push({ kind: "text", text: text.slice(consumed, match.index) });
    segments.push({ kind: "file", text: match[0], target });
    consumed = match.index + match[0].length;
  }
  if (consumed < text.length) segments.push({ kind: "text", text: text.slice(consumed) });
  return segments;
}
