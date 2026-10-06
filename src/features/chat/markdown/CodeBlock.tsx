import { Check, Copy } from "lucide-react";
import { Fragment, useMemo, type ReactNode } from "react";

import { IconButton } from "@/shared/ui/IconButton";

import { copyLabel, type CopyStatus } from "./copy-machine";
import { StreamingCaret } from "./StreamingCaret";
import { useCopy } from "./use-copy";
import { colourableSource, useHighlight, type Highlight } from "./use-highlight";

const COPY_TONES: Record<CopyStatus, string> = {
  idle: "",
  copied: "text-success!",
  failed: "text-danger!",
};

function CopyButton({ text }: { text: string }) {
  const { status, copy } = useCopy(text);
  return (
    <>
      <IconButton
        icon={status === "copied" ? Check : Copy}
        label={copyLabel(status)}
        onClick={copy}
        className={COPY_TONES[status]}
      />
      {status === "idle" ? null : (
        <span role="status" className="sr-only">
          {copyLabel(status)}
        </span>
      )}
    </>
  );
}

function renderHighlight(highlight: Highlight): ReactNode {
  const last = highlight.lines.length - 1;
  return highlight.lines.map((line, row) => (
    <Fragment key={row}>
      {line.map((span, column) => (
        <span key={column} className={span.className}>
          {span.text}
        </span>
      ))}
      {row < last ? "\n" : null}
    </Fragment>
  ));
}

/** The coloured lines followed by the text that has not been coloured yet; plain text when nothing matches. */
function useCodeContent(code: string, language: string | null, open: boolean): ReactNode {
  const highlight = useHighlight(colourableSource(code, open), language);
  const coloured = useMemo(() => (highlight === null ? null : renderHighlight(highlight)), [highlight]);
  if (highlight === null || coloured === null || !code.startsWith(highlight.source)) return code;
  return (
    <>
      {coloured}
      {code.slice(highlight.source.length)}
    </>
  );
}

interface CodeBlockProps {
  code: string;
  language: string | null;
  /** The block is still being written: it ends in the streaming caret and its last line stays plain. */
  open: boolean;
}

export function CodeBlock({ code, language, open }: CodeBlockProps) {
  const content = useCodeContent(code, language, open);
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <figcaption className="flex h-8 items-center justify-between border-b border-border bg-surface-2 pr-1 pl-3 text-[11px] text-fg-subtle">
        <span className="truncate font-mono">{language ?? "text"}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 whitespace-pre text-fg [tab-size:4]">
        <code>
          {content}
          {open ? <StreamingCaret /> : null}
        </code>
      </pre>
    </figure>
  );
}
