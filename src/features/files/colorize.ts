import * as monaco from "monaco-editor";

import { parseColorizedHtml, type ColorizedLine } from "./colorized-html";
import { matchLanguageHint } from "./monaco-model";
import { MONACO_THEME } from "./monaco-setup";

const TAB_SIZE = 4;

/**
 * Colours `code` with the editor's own tokenizer and theme so snippets look like the Files panel.
 * Resolves to null when Monaco has no language for `languageHint`. Loads Monaco, so import it lazily.
 */
export async function colorizeCode(code: string, languageHint: string): Promise<ColorizedLine[] | null> {
  const language = matchLanguageHint(languageHint, monaco.languages.getLanguages());
  if (language === null) return null;
  monaco.editor.setTheme(MONACO_THEME);
  const html = await monaco.editor.colorize(code, language, { tabSize: TAB_SIZE });
  return parseColorizedHtml(html);
}
