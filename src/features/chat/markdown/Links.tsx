import type { KeyboardEvent, ReactNode } from "react";

import { Tooltip } from "@/shared/ui/Tooltip";

import type { FileTarget } from "./file-refs";
import { useMarkdownServices } from "./services";
import { LINK } from "./styles";

interface InlineLinkProps {
  kind: "external" | "file";
  label: string;
  detail: string;
  onActivate: () => void;
  children: ReactNode;
}

function activateOnEnter(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    action();
  };
}

/**
 * Clickable text that wraps like the words around it. It has no `href`, so nothing - a click, a middle click,
 * a drop - can make the webview navigate away from the app: what happens on activation is up to `onActivate`.
 */
function InlineLink({ kind, label, detail, onActivate, children }: InlineLinkProps) {
  return (
    <Tooltip content={label} detail={detail}>
      <a role="link" tabIndex={0} data-link={kind} onClick={onActivate} onKeyDown={activateOnEnter(onActivate)} className={LINK}>
        {children}
      </a>
    </Tooltip>
  );
}

/** Opens in the user's browser. */
export function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  const { openUrl } = useMarkdownServices();
  return (
    <InlineLink
      kind="external"
      label="Open in your browser"
      detail={url}
      onActivate={() => {
        openUrl(url);
      }}
    >
      {children}
    </InlineLink>
  );
}

function describeTarget(target: FileTarget): string {
  return target.line === null ? "Open in Files" : `Open in Files at line ${target.line}`;
}

/** Opens a project file in the Files panel, at the referenced line when there is one. */
export function FileReference({ target, children }: { target: FileTarget; children: ReactNode }) {
  const { openFile } = useMarkdownServices();
  return (
    <InlineLink
      kind="file"
      label={describeTarget(target)}
      detail={target.path}
      onActivate={() => {
        openFile(target);
      }}
    >
      {children}
    </InlineLink>
  );
}
