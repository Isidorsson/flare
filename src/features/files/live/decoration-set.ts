import type { editor } from "monaco-editor";

import type { Decoration } from "./decorations";

/**
 * Decorations on one model, replaced as a whole. They live in the model rather
 * than in an editor's collection, so they survive the editor showing another
 * model for a while and can still be removed afterwards.
 */
export class DecorationSet {
  readonly #model: editor.ITextModel;
  #ids: string[] = [];

  constructor(model: editor.ITextModel) {
    this.#model = model;
  }

  set(decorations: readonly Decoration[]): void {
    if (this.#model.isDisposed()) return;
    this.#ids = this.#model.deltaDecorations(this.#ids, [...decorations]);
  }

  clear(): void {
    this.set([]);
  }
}
