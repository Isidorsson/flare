import { baseName } from "./paths";

export const PLAINTEXT_LANGUAGE = "plaintext";

export interface LanguageDefinition {
  id: string;
  extensions?: readonly string[] | undefined;
  filenames?: readonly string[] | undefined;
  aliases?: readonly string[] | undefined;
}

export type DiffSide = "original" | "modified";

const DRIVE_SEGMENT = /^[A-Za-z]:$/;

function encodeSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => (DRIVE_SEGMENT.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
}

export function fileModelUri(path: string): string {
  return `file:///${encodeSegments(path.replace(/^\//, ""))}`;
}

export function diffModelUri(changeId: string, side: DiffSide): string {
  return `inmemory://flare-diff/${encodeURIComponent(changeId)}/${side}`;
}

function candidateExtensions(name: string): string[] {
  const candidates: string[] = [];
  for (let dot = name.indexOf("."); dot >= 0; dot = name.indexOf(".", dot + 1)) {
    candidates.push(name.slice(dot));
  }
  return candidates;
}

/** Picks a Monaco language id from a file name: exact file names first, then the longest matching extension. */
export function pickLanguage(path: string, languages: readonly LanguageDefinition[]): string {
  const name = baseName(path).toLowerCase();
  const byName = languages.find((language) => language.filenames?.some((candidate) => candidate.toLowerCase() === name));
  if (byName) return byName.id;
  for (const extension of candidateExtensions(name)) {
    const match = languages.find((language) => language.extensions?.some((candidate) => candidate.toLowerCase() === extension));
    if (match) return match.id;
  }
  return PLAINTEXT_LANGUAGE;
}

/** Maps a code fence's info string (`ts`, `bash`, `tsx`) to a Monaco language id: by id, then alias, then extension. */
export function matchLanguageHint(hint: string, languages: readonly LanguageDefinition[]): string | null {
  const wanted = hint.trim().toLowerCase();
  if (wanted === "") return null;
  const extension = `.${wanted}`;
  const tiers = [
    (language: LanguageDefinition) => language.id.toLowerCase() === wanted,
    (language: LanguageDefinition) => language.aliases?.some((alias) => alias.toLowerCase() === wanted) === true,
    (language: LanguageDefinition) => language.extensions?.some((candidate) => candidate.toLowerCase() === extension) === true,
  ];
  for (const isMatch of tiers) {
    const found = languages.find(isMatch);
    if (found) return found.id;
  }
  return null;
}
