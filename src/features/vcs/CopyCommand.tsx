import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/shared/ui/IconButton";

const COPIED_MS = 1500;

/** A command to run in a terminal: selectable, with a button that copies it. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  function copy() {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
      })
      .catch((error: unknown) => {
        console.error("flare: copying to the clipboard failed", error);
      });
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg select-text">{command}</code>
      <IconButton
        icon={copied ? Check : Copy}
        label="Copy the command"
        detail={copied ? "Copied" : "Puts the command on the clipboard"}
        className="size-6"
        onClick={copy}
      />
    </div>
  );
}
