import { MarkdownNode } from "./nodes";
import { StreamingCaret } from "./StreamingCaret";
import { useMarkdownBlocks } from "./use-markdown-blocks";

interface MarkdownProps {
  text: string;
  /** More text is still arriving: half-written markdown is tolerated and the streaming caret is shown. */
  streaming: boolean;
}

/**
 * Renders assistant text as markdown. It never produces HTML from the text: every node becomes a React
 * element, raw HTML in the source is shown as plain text, and links open outside the webview.
 */
export function Markdown({ text, streaming }: MarkdownProps) {
  const blocks = useMarkdownBlocks(text, streaming);
  const lastKey = blocks.at(-1)?.key;
  return (
    <div className="flex flex-col gap-2.5 break-words whitespace-pre-line">
      {blocks.map((block) => (
        <MarkdownNode key={block.key} node={block.node} caret={streaming && block.key === lastKey} />
      ))}
      {blocks.length === 0 && streaming ? <StreamingCaret /> : null}
    </div>
  );
}
