import { Editor } from "@monaco-editor/react";
import { useMemo } from "react";

import { fileModelUri } from "./monaco-model";
import { BASE_EDITOR_OPTIONS, MONACO_THEME, SAVE_KEYBINDING, languageForPath } from "./monaco-setup";

interface MonacoFileEditorProps {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

/** Render with `key={path}` so each file gets its own model and the save command sees the right path. */
export function MonacoFileEditor({ path, value, onChange, onSave }: MonacoFileEditorProps) {
  const language = useMemo(() => languageForPath(path), [path]);
  return (
    <Editor
      path={fileModelUri(path)}
      language={language}
      value={value}
      theme={MONACO_THEME}
      loading={null}
      options={BASE_EDITOR_OPTIONS}
      onChange={(next) => {
        onChange(next ?? "");
      }}
      onMount={(editor) => {
        editor.addCommand(SAVE_KEYBINDING, onSave);
      }}
    />
  );
}
