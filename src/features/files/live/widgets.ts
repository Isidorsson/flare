import * as monaco from "monaco-editor";

import { LIVE } from "./timing";
import { phantomLines } from "./typing-preview";

type Editor = monaco.editor.IStandaloneCodeEditor;

export type LabelTone = "read" | "edit";

function element(tag: string, className: string, text = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function lineHeightOf(editor: Editor): number {
  return editor.getOption(monaco.editor.EditorOption.lineHeight);
}

/** The collaborator caret: a blinking bar in Claude's colour at the end of the text being written, with a name tag. */
export class CaretWidget implements monaco.editor.IContentWidget {
  readonly #node: HTMLElement;
  #position: monaco.IPosition | null = null;

  constructor(lineHeight: number) {
    this.#node = element("div", "flare-caret");
    this.#node.style.setProperty("--flare-line-height", `${String(lineHeight)}px`);
    this.#node.append(element("span", "flare-caret-bar"), element("span", "flare-caret-tag", "Claude"));
  }

  getId(): string {
    return "flare.caret";
  }

  getDomNode(): HTMLElement {
    return this.#node;
  }

  getPosition(): monaco.editor.IContentWidgetPosition | null {
    if (this.#position === null) return null;
    return { position: this.#position, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] };
  }

  moveTo(line: number, column: number): void {
    this.#position = { lineNumber: line, column };
  }
}

/** The label floating above the first line being read or edited. */
export class LabelWidget implements monaco.editor.IContentWidget {
  readonly #node: HTMLElement;
  #line = 1;

  constructor(text: string, tone: LabelTone) {
    this.#node = element("div", `flare-label flare-label-${tone}`, text);
  }

  getId(): string {
    return "flare.label";
  }

  getDomNode(): HTMLElement {
    return this.#node;
  }

  getPosition(): monaco.editor.IContentWidgetPosition {
    const { ABOVE, BELOW } = monaco.editor.ContentWidgetPositionPreference;
    return { position: { lineNumber: this.#line, column: 1 }, preference: [ABOVE, BELOW] };
  }

  moveTo(line: number): void {
    this.#line = line;
  }

  update(text: string, tone: LabelTone): void {
    this.#node.className = `flare-label flare-label-${tone}`;
    this.#node.textContent = text;
  }
}

/** Typed text that cannot be placed in the file, shown in a panel at the top of the editor. */
export class TypingPanelWidget implements monaco.editor.IOverlayWidget {
  readonly #node: HTMLElement;
  readonly #text: HTMLElement;

  constructor(title: string) {
    this.#node = element("div", "flare-typing-panel");
    this.#text = element("pre", "flare-typing-panel-text");
    this.#node.append(element("div", "flare-typing-panel-title", title), this.#text);
  }

  getId(): string {
    return "flare.typing-panel";
  }

  getDomNode(): HTMLElement {
    return this.#node;
  }

  getPosition(): monaco.editor.IOverlayWidgetPosition {
    return { preference: monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER };
  }

  setText(text: string): void {
    this.#text.textContent = text;
  }
}

function phantomNode(editor: Editor, removed: readonly string[], persist: boolean): { node: HTMLElement; height: number } {
  const { shown, hidden } = phantomLines(removed);
  const font = editor.getRawOptions();
  const node = element("div", persist ? "flare-phantom flare-phantom-persist" : "flare-phantom");
  node.style.fontFamily = font.fontFamily ?? "";
  node.style.fontSize = `${String(font.fontSize ?? 12)}px`;
  for (const text of shown) node.append(element("div", "flare-phantom-line", text === "" ? " " : text));
  if (hidden > 0) node.append(element("div", "flare-phantom-line flare-phantom-more", `… ${String(hidden)} more removed lines`));
  for (const line of node.children) {
    if (line instanceof HTMLElement) line.style.height = `${String(lineHeightOf(editor))}px`;
  }
  return { node, height: shown.length + (hidden > 0 ? 1 : 0) };
}

/** Blocks of struck-through red lines that sit above the place where lines were removed, and go once they have faded. */
export class PhantomZones {
  readonly #editor: Editor;
  // Each zone with the timer that removes it, or null for one that stays.
  readonly #zones = new Map<string, number | null>();

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** A block that fades out and goes by itself, or one that stays until it is cleared (while an edit is still being typed). */
  add(afterLine: number, removed: readonly string[], { persist }: { persist: boolean }): void {
    if (removed.length === 0) return;
    const { node, height } = phantomNode(this.#editor, removed, persist);
    this.#editor.changeViewZones((accessor) => {
      const id = accessor.addZone({ afterLineNumber: Math.max(0, afterLine), heightInLines: height, domNode: node, suppressMouseDown: true });
      const gone = persist ? null : window.setTimeout(() => {
        this.#remove(id);
      }, LIVE.edit.phantomFadeDelayMs + LIVE.edit.phantomFadeMs);
      this.#zones.set(id, gone);
    });
  }

  clear(): void {
    for (const id of [...this.#zones.keys()]) this.#remove(id);
  }

  #remove(id: string): void {
    const timer = this.#zones.get(id);
    if (timer === undefined) return;
    if (timer !== null) window.clearTimeout(timer);
    this.#zones.delete(id);
    this.#editor.changeViewZones((accessor) => {
      accessor.removeZone(id);
    });
  }
}
