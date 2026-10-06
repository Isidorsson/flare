import * as monaco from "monaco-editor";

import { DecorationSet } from "./decoration-set";
import { typingDecorations } from "./decorations";
import { replacedSpan, withLineBreaks } from "./line-diff";
import type { TypingView } from "./typing-preview";

type Editor = monaco.editor.IStandaloneCodeEditor;

/**
 * Shows an edit the model is still typing without touching the file's own
 * model: the editor swaps to a scratch copy of the file with the typed text in
 * place and goes read-only, then swaps back. Nothing the user could save or
 * undo is ever changed.
 */
export class TypingSession {
  readonly #editor: Editor;
  readonly #real: monaco.editor.ITextModel;
  #scratch: monaco.editor.ITextModel | null = null;
  #decorations: DecorationSet | null = null;

  constructor(editor: Editor, real: monaco.editor.ITextModel) {
    this.#editor = editor;
    this.#real = real;
  }

  get active(): boolean {
    return this.#scratch !== null;
  }

  show(view: TypingView): void {
    const scratch = this.#scratch ?? this.#enter(view);
    const text = withLineBreaks(view.content, scratch.getEOL());
    const edit = replacedSpan(scratch.getValue(), text);
    if (edit !== null) {
      const start = scratch.getPositionAt(edit.offset);
      const end = scratch.getPositionAt(edit.offset + edit.length);
      scratch.applyEdits([{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: edit.text }]);
    }
    this.#decorations?.set(typingDecorations(view.typedStart, view.typedEnd));
  }

  hide(): void {
    const scratch = this.#scratch;
    if (scratch === null) return;
    const state = this.#editor.saveViewState();
    this.#decorations?.clear();
    this.#decorations = null;
    this.#scratch = null;
    this.#editor.setModel(this.#real);
    this.#editor.updateOptions({ readOnly: false });
    if (state !== null) this.#editor.restoreViewState(state);
    scratch.dispose();
  }

  #enter(view: TypingView): monaco.editor.ITextModel {
    const state = this.#editor.saveViewState();
    const scratch = monaco.editor.createModel(view.content, this.#real.getLanguageId());
    this.#editor.setModel(scratch);
    this.#editor.updateOptions({ readOnly: true });
    if (state !== null) this.#editor.restoreViewState(state);
    this.#scratch = scratch;
    this.#decorations = new DecorationSet(scratch);
    return scratch;
  }
}
