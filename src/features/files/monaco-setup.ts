import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

import { pickLanguage } from "./monaco-model";

export const MONACO_THEME = "flare-dark";

type WorkerConstructor = new () => Worker;

const WORKERS_BY_LABEL: Record<string, WorkerConstructor> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
  typescript: TsWorker,
  javascript: TsWorker,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readColor(name: string): string {
  const value = readToken(name);
  if (!HEX_COLOR.test(value)) throw new Error(`Design token ${name} must be a #rrggbb colour, got "${value}"`);
  return value;
}

function defineFlareTheme() {
  const alpha = (hex: string, opacity: string) => `${hex}${opacity}`;
  const surface = readColor("--color-surface-1");
  const accent = readColor("--color-accent");
  const success = readColor("--color-success");
  const danger = readColor("--color-danger");
  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": surface,
      "editor.foreground": readColor("--color-fg"),
      "editorGutter.background": surface,
      "editorLineNumber.foreground": readColor("--color-fg-subtle"),
      "editorLineNumber.activeForeground": readColor("--color-fg-muted"),
      "editor.lineHighlightBackground": alpha(readColor("--color-surface-3"), "80"),
      "editor.selectionBackground": alpha(accent, "40"),
      "editor.inactiveSelectionBackground": alpha(accent, "22"),
      "editorCursor.foreground": accent,
      "editorIndentGuide.background1": readColor("--color-border"),
      "editorWidget.background": readColor("--color-surface-2"),
      "editorWidget.border": readColor("--color-border-strong"),
      "scrollbarSlider.background": alpha(readColor("--color-border-strong"), "80"),
      "diffEditor.insertedTextBackground": alpha(success, "30"),
      "diffEditor.insertedLineBackground": alpha(success, "18"),
      "diffEditor.removedTextBackground": alpha(danger, "30"),
      "diffEditor.removedLineBackground": alpha(danger, "18"),
    },
  });
}

function quietTypeScriptDiagnostics() {
  const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(diagnostics);
}

// Monaco is bundled locally (no CDN) so the Tauri CSP can stay strict. These
// run once, when the lazily loaded editor chunk is first imported.
loader.config({ monaco });
self.MonacoEnvironment = {
  getWorker: (_workerId, label) => new (WORKERS_BY_LABEL[label] ?? EditorWorker)(),
};
defineFlareTheme();
quietTypeScriptDiagnostics();

export const BASE_EDITOR_OPTIONS: monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions = {
  fontFamily: readToken("--font-mono"),
  fontSize: 12.5,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: "on",
  renderWhitespace: "none",
  fixedOverflowWidgets: true,
  overviewRulerLanes: 0,
  padding: { top: 8, bottom: 8 },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

export function languageForPath(path: string): string {
  return pickLanguage(path, monaco.languages.getLanguages());
}

export const SAVE_KEYBINDING = monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS;
