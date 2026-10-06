import { SendHorizontal, Square } from "lucide-react";
import { useState, type KeyboardEvent, type SubmitEvent } from "react";

import { selectComposerMode, type ComposerMode } from "@/features/agent/agent-selectors";
import { useAgent } from "@/features/agent/use-agent";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { IconButton } from "@/shared/ui/IconButton";

import { SessionPicker } from "./SessionPicker";

const PLACEHOLDERS: Record<ComposerMode, string> = {
  "no-folder": "Open a folder to start",
  blocked: "Another thread is running",
  running: "Claude is working",
  ready: "Message Claude",
};

const HINTS: Record<ComposerMode, string> = {
  "no-folder": "Pick a project folder in the sidebar so Claude knows where to work.",
  blocked: "Switch back to the running thread to stop it first.",
  running: "Press stop to interrupt the current turn.",
  ready: "Enter sends, Shift+Enter adds a new line.",
};

export function Composer() {
  const root = useWorkspace((state) => state.root);
  const mode = useAgent((state) => selectComposerMode(state, root));
  const sendMessage = useAgent((state) => state.sendMessage);
  const interrupt = useAgent((state) => state.interrupt);
  const [draft, setDraft] = useState("");
  const canType = mode === "ready";

  function submit() {
    if (!canType || draft.trim() === "") return;
    sendMessage(draft);
    setDraft("");
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pb-3">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-1 p-2 focus-within:border-border-strong">
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={!canType}
          rows={2}
          aria-label="Message Claude"
          placeholder={PLACEHOLDERS[mode]}
          className="min-h-10 max-h-48 flex-1 resize-none bg-transparent px-2 py-1 text-sm text-fg outline-none select-text placeholder:text-fg-subtle disabled:cursor-not-allowed"
        />
        {mode === "running" ? (
          <IconButton icon={Square} label="Stop" onClick={interrupt} className="text-danger" />
        ) : (
          <IconButton icon={SendHorizontal} label="Send message" type="submit" disabled={!canType || draft.trim() === ""} />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SessionPicker />
        <p className="text-[11px] text-fg-subtle">{HINTS[mode]}</p>
      </div>
    </form>
  );
}
