export type KeyAction = "copy" | "none";

export interface KeyChord {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Ctrl+C copies only while text is selected, otherwise it stays an interrupt;
 * Ctrl+Shift+C always copies. Paste (Ctrl+V, Ctrl+Shift+V) is left to the
 * browser, which ghostty-web already turns into a bracketed paste.
 */
export function classifyKey(chord: KeyChord, hasSelection: boolean): KeyAction {
  if (!chord.ctrlKey || chord.altKey || chord.metaKey || chord.code !== "KeyC") return "none";
  return chord.shiftKey || hasSelection ? "copy" : "none";
}
