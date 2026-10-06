import { parseFileDestination, type FileTarget } from "./file-refs";

export type LinkTarget =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "file"; readonly target: FileTarget }
  | { readonly kind: "none" };

const NO_TARGET: LinkTarget = { kind: "none" };

const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:"]);
// A tab or newline inside "java\tscript:" is dropped by URL parsers, so such a destination is never trusted.
const CONTROL_CHARACTERS = /\p{Cc}/u;

/**
 * Decides what a markdown link or image destination may do. Only web and mail links leave the app, and they
 * leave by their parsed form; anything else is either a project file or nothing at all. Nothing ever navigates
 * the webview.
 */
export function classifyHref(href: string): LinkTarget {
  const value = href.trim();
  if (value === "" || CONTROL_CHARACTERS.test(value)) return NO_TARGET;
  if (URL.canParse(value)) {
    const url = new URL(value);
    if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: "external", url: url.href };
  }
  const target = parseFileDestination(value);
  return target === null ? NO_TARGET : { kind: "file", target };
}

/** Same rule for images, which are never fetched: a remote one is offered as a link instead. */
export function classifyImageHref(href: string): LinkTarget {
  const target = classifyHref(href);
  return target.kind === "external" && !target.url.startsWith("mailto:") ? target : NO_TARGET;
}
