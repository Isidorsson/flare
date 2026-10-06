import * as monaco from "monaco-editor";

import type { FilesStore } from "../files-store";
import { fileModelUri } from "../monaco-model";
import { BASE_EDITOR_OPTIONS, MONACO_THEME, SAVE_KEYBINDING, languageForPath, readColor } from "../monaco-setup";
import { diffLines } from "./line-diff";
import type { LiveStore } from "./live-store";
import { PlayRenderer } from "./play-renderer";
import { turnMarks } from "./turn-summary";

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  ...BASE_EDITOR_OPTIONS,
  theme: MONACO_THEME,
  automaticLayout: true,
  overviewRulerLanes: 3,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
};

export interface EditorControllerDeps {
  container: HTMLElement;
  path: string;
  files: FilesStore;
  live: LiveStore;
}

/**
 * One Monaco editor for one open file, kept in step with the stores: the
 * file's text, what the agent is doing to it, and the marks of this turn. The
 * stores are the source of truth; this only mirrors them into the editor.
 */
export class LiveEditorController {
  readonly #path: string;
  readonly #files: FilesStore;
  readonly #editor: monaco.editor.IStandaloneCodeEditor;
  readonly #model: monaco.editor.ITextModel;
  readonly #renderer: PlayRenderer;
  readonly #cleanups: (() => void)[] = [];
  // True while the agent's text is being put into the model, so it is not mistaken for the user typing.
  #applying = false;

  constructor({ container, path, files, live }: EditorControllerDeps) {
    this.#path = path;
    this.#files = files;
    const uri = monaco.Uri.parse(fileModelUri(path));
    monaco.editor.getModel(uri)?.dispose();
    this.#model = monaco.editor.createModel(files.getState().files[path]?.draft ?? "", languageForPath(path), uri);
    this.#editor = monaco.editor.create(container, { ...EDITOR_OPTIONS, model: this.#model });
    this.#renderer = new PlayRenderer(this.#editor, this.#model, path, readColor("--color-success"));
    this.#editor.addCommand(SAVE_KEYBINDING, () => {
      files
        .getState()
        .saveFile(path)
        .catch((error: unknown) => {
          console.error(`flare: saving ${path} failed`, error);
        });
    });
    this.#connect(live);
  }

  dispose(): void {
    for (const cleanup of this.#cleanups) cleanup();
    this.#renderer.dispose();
    this.#editor.dispose();
    this.#model.dispose();
  }

  #connect(live: LiveStore): void {
    const typing = this.#model.onDidChangeContent(() => {
      if (!this.#applying) this.#files.getState().setDraft(this.#path, this.#model.getValue());
    });
    this.#cleanups.push(
      () => {
        typing.dispose();
      },
      this.#files.subscribe((state, previous) => {
        if (state.files[this.#path]?.draft !== previous.files[this.#path]?.draft) this.#syncContent();
        if (state.changes !== previous.changes || state.turnId !== previous.turnId) this.#refreshMarks();
        if (state.reveal !== previous.reveal) this.#showRequestedLine();
      }),
      live.subscribe((state, previous) => {
        if (state.play !== previous.play) this.#renderer.render(state.play);
      }),
    );
    this.#refreshMarks();
    this.#renderer.render(live.getState().play);
    this.#showRequestedLine();
  }

  // The request waits in the store until this file's editor exists, so it is also read once on creation.
  #showRequestedLine(): void {
    const { reveal } = this.#files.getState();
    if (reveal?.path !== this.#path) return;
    const lineNumber = Math.min(Math.max(reveal.line, 1), this.#model.getLineCount());
    this.#editor.setPosition({ lineNumber, column: 1 });
    this.#editor.revealLineInCenter(lineNumber);
    this.#files.getState().clearReveal(reveal.id);
  }

  #refreshMarks(): void {
    const { changes, turnId } = this.#files.getState();
    this.#renderer.setMarks(turnMarks(changes, turnId, this.#path));
  }

  #syncContent(): void {
    const draft = this.#files.getState().files[this.#path]?.draft;
    if (draft === undefined || draft === this.#model.getValue()) return;
    this.#applyExternal(draft);
    this.#refreshMarks();
  }

  // Only the lines that changed are replaced, so the cursor, the scroll position and the marks stay where they are.
  #applyExternal(text: string): void {
    const model = this.#model;
    const edits = diffLines(model.getValue(), text).map(({ edit }) => {
      const start = model.getPositionAt(edit.offset);
      const end = model.getPositionAt(edit.offset + edit.length);
      return { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: edit.text };
    });
    this.#whileApplying(() => {
      model.pushStackElement();
      model.pushEditOperations([], edits, () => null);
      model.pushStackElement();
      if (model.getValue() !== text) model.setValue(text);
    });
  }

  #whileApplying(run: () => void): void {
    this.#applying = true;
    try {
      run();
    } finally {
      this.#applying = false;
    }
  }
}
