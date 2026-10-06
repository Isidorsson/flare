/** One run of text with the Monaco token class (`mtk3`, `mtk3 mtki`, ...) that the active theme colours. */
export interface ColorizedSpan {
  text: string;
  className: string;
}

export type ColorizedLine = readonly ColorizedSpan[];

// Monaco's colorizer emits one `<span>` per line holding `<span class="mtkN">` runs, each line followed by `<br/>`.
// Anything else means Monaco changed its markup, which must fail loudly rather than be passed on.
const TOKEN = /<span([^>]*)>|<\/span>|<br\/>|([^<]+)/g;
const CLASS_ATTRIBUTE = /(?:^|\s)class="([^"]*)"/;
const TOKEN_CLASS = /^mtk[a-z0-9]*(?: mtk[a-z0-9]*)*$/;
const ENTITY = /&(lt|gt|amp|quot|#(\d+));/g;
const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' };
const NO_BREAK_SPACE = /\u00a0/g;

function decodeEntities(text: string): string {
  return text
    .replace(ENTITY, (_whole, name: string, code: string | undefined) =>
      code === undefined ? (NAMED_ENTITIES[name] ?? "") : String.fromCharCode(Number(code)),
    )
    .replace(NO_BREAK_SPACE, " ");
}

function readClass(attributes: string, offset: number): string {
  const className = CLASS_ATTRIBUTE.exec(attributes)?.[1] ?? "";
  if (className !== "" && !TOKEN_CLASS.test(className)) {
    throw new Error(`Unexpected class "${className}" in colorized code at offset ${offset}`);
  }
  return className;
}

function malformed(offset: number): Error {
  return new Error(`Unexpected markup in colorized code at offset ${offset}`);
}

interface Scan {
  lines: ColorizedSpan[][];
  classes: string[];
}

function applyToken(scan: Scan, [whole, attributes, text]: RegExpMatchArray, offset: number): void {
  if (text !== undefined) {
    const className = scan.classes.findLast((name) => name !== "") ?? "";
    scan.lines.at(-1)?.push({ text: decodeEntities(text), className });
  } else if (attributes !== undefined) {
    scan.classes.push(readClass(attributes, offset));
  } else if (whole === "</span>") {
    scan.classes.pop();
  } else {
    scan.lines.push([]);
  }
}

/** Splits Monaco's colorized HTML into lines of styled text. The result has one entry per source line. */
export function parseColorizedHtml(html: string): ColorizedLine[] {
  const scan: Scan = { lines: [[]], classes: [] };
  let offset = 0;
  for (const token of html.matchAll(TOKEN)) {
    if (token.index !== offset) throw malformed(offset);
    applyToken(scan, token, offset);
    offset += token[0].length;
  }
  if (offset !== html.length) throw malformed(offset);
  return scan.lines.at(-1)?.length === 0 ? scan.lines.slice(0, -1) : scan.lines;
}
