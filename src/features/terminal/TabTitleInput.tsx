import { useRef, type KeyboardEvent } from "react";

import { TAB_TITLE_MAX_LENGTH } from "./terminal-constants";

interface TabTitleInputProps {
  initialTitle: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}

export function TabTitleInput({ initialTitle, onCommit, onCancel }: TabTitleInputProps) {
  const settled = useRef(false);

  const settle = (finish: () => void) => {
    if (settled.current) return;
    settled.current = true;
    finish();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") settle(() => { onCommit(event.currentTarget.value); });
    if (event.key === "Escape") settle(onCancel);
  };

  return (
    <input
      autoFocus
      aria-label="Terminal name"
      defaultValue={initialTitle}
      maxLength={TAB_TITLE_MAX_LENGTH}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        settle(() => { onCommit(event.currentTarget.value); });
      }}
      className="h-6 w-28 rounded-sm border border-accent bg-surface-3 px-1.5 text-xs text-fg outline-none"
    />
  );
}
