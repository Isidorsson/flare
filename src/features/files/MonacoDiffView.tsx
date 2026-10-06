import { DiffEditor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";

import type { TimelineEntry } from "./files-types";
import { diffModelUri } from "./monaco-model";
import { BASE_EDITOR_OPTIONS, MONACO_THEME, languageForPath } from "./monaco-setup";

const DIFF_OPTIONS: editor.IDiffEditorConstructionOptions = {
  ...BASE_EDITOR_OPTIONS,
  readOnly: true,
  originalEditable: false,
  renderOverviewRuler: false,
  enableSplitViewResizing: false,
  ignoreTrimWhitespace: false,
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
};

/**
 * Detach and dispose the models before the wrapper tears the widget down:
 * disposing a model that a diff widget still shows throws inside Monaco.
 */
function releaseModels(diff: editor.IStandaloneDiffEditor | null) {
  const models = diff?.getModel();
  diff?.setModel(null);
  models?.original.dispose();
  models?.modified.dispose();
}

/** Render with `key={entry.id}` so every change gets a fresh widget and fresh models. */
export function MonacoDiffView({ entry }: { entry: TimelineEntry }) {
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  useEffect(
    () => () => {
      releaseModels(diffRef.current);
      diffRef.current = null;
    },
    [],
  );

  return (
    <DiffEditor
      original={entry.before ?? ""}
      modified={entry.after}
      language={languageForPath(entry.path)}
      originalModelPath={diffModelUri(entry.id, "original")}
      modifiedModelPath={diffModelUri(entry.id, "modified")}
      theme={MONACO_THEME}
      loading={null}
      options={DIFF_OPTIONS}
      onMount={(diff) => {
        diffRef.current = diff;
      }}
    />
  );
}
