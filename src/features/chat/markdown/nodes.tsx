import { ImageIcon } from "lucide-react";
import type { AlignType, Heading, RootContent, RootContentMap, Table } from "mdast";
import { Fragment, memo, type ReactNode } from "react";

import { CodeBlock } from "./CodeBlock";
import { parseFileReference, splitFileReferences } from "./file-refs";
import { classifyHref, classifyImageHref } from "./link-target";
import { ExternalLink, FileReference } from "./Links";
import { StreamingCaret } from "./StreamingCaret";
import { INLINE_CODE, NESTED_STACK, PROSE_WIDTH } from "./styles";

interface Context {
  /** The streaming caret goes after the last piece of text that this node renders. */
  caret: boolean;
  /** Inside a link, text is not searched for file references: a link cannot hold another one. */
  inLink: boolean;
}

type Renderers = { [K in keyof RootContentMap]: (node: RootContentMap[K], context: Context) => ReactNode };

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const satisfies Record<Heading["depth"], string>;

const HEADING_STYLES: Record<Heading["depth"], string> = {
  1: "text-base font-semibold text-fg",
  2: "text-[15px] font-semibold text-fg",
  3: "text-sm font-semibold text-fg",
  4: "text-sm font-medium text-fg",
  5: "text-sm font-medium text-fg-muted",
  6: "text-xs font-medium tracking-wide text-fg-muted uppercase",
};

const ALIGNMENT: Record<NonNullable<AlignType>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const LIST_STYLE = `${PROSE_WIDTH} space-y-1 pl-5 marker:text-fg-subtle`;
const RAW_TEXT = "font-mono text-[0.9em] whitespace-pre-wrap text-fg-muted";
const LINE_BREAK_TAG = /^<br\s*\/?>$/i;

function withCaret(content: ReactNode, context: Context): ReactNode {
  return context.caret ? (
    <>
      {content}
      <StreamingCaret />
    </>
  ) : (
    content
  );
}

function renderChildren(nodes: readonly RootContent[], context: Context): ReactNode {
  const last = nodes.length - 1;
  return nodes.map((child, index) => (
    <Fragment key={index}>{renderNode(child, index === last ? context : { ...context, caret: false })}</Fragment>
  ));
}

function renderText(value: string, context: Context): ReactNode {
  if (context.inLink) return withCaret(value, context);
  const segments = splitFileReferences(value);
  return withCaret(
    segments.map((segment, index) =>
      segment.kind === "text" ? (
        <Fragment key={index}>{segment.text}</Fragment>
      ) : (
        <FileReference key={index} target={segment.target}>
          <span className="font-mono text-[0.9em]">{segment.text}</span>
        </FileReference>
      ),
    ),
    context,
  );
}

function renderInlineCode(value: string, context: Context): ReactNode {
  const target = context.inLink ? null : parseFileReference(value);
  if (target === null) return withCaret(<code className={`${INLINE_CODE} text-fg`}>{value}</code>, context);
  return withCaret(
    <FileReference target={target}>
      <code className={INLINE_CODE}>{value}</code>
    </FileReference>,
    context,
  );
}

function renderLink(url: string, children: readonly RootContent[], context: Context): ReactNode {
  const target = classifyHref(url);
  if (target.kind === "none") return renderChildren(children, context);
  const label = renderChildren(children, { ...context, inLink: true });
  return target.kind === "external" ? (
    <ExternalLink url={target.url}>{label}</ExternalLink>
  ) : (
    <FileReference target={target.target}>{label}</FileReference>
  );
}

function renderImage(url: string, alt: string | null | undefined, context: Context): ReactNode {
  const label = alt === null || alt === undefined || alt === "" ? url : alt;
  const target = classifyImageHref(url);
  if (target.kind !== "external") return withCaret(<span className="text-fg-muted">{label}</span>, context);
  return withCaret(
    <ExternalLink url={target.url}>
      <ImageIcon aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
      {label}
    </ExternalLink>,
    context,
  );
}

function renderHeading(node: Heading, context: Context): ReactNode {
  const Tag = HEADING_TAGS[node.depth];
  return <Tag className={`${HEADING_STYLES[node.depth]} ${PROSE_WIDTH}`}>{renderChildren(node.children, context)}</Tag>;
}

function renderTable(node: Table): ReactNode {
  const [header, ...body] = node.children;
  const quiet: Context = { caret: false, inLink: false };
  const cellStyle = (index: number) => `px-2.5 py-1.5 align-top ${ALIGNMENT[node.align?.[index] ?? "left"]}`;
  const cells = (row: RootContentMap["tableRow"], Cell: "th" | "td") =>
    row.children.map((cell, index) => (
      <Cell key={index} className={cellStyle(index)}>
        {renderChildren(cell.children, quiet)}
      </Cell>
    ));
  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="bg-surface-2 font-medium text-fg">{header === undefined ? null : <tr>{cells(header, "th")}</tr>}</thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {cells(row, "td")}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderTaskBox(checked: boolean): ReactNode {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled
      aria-label={checked ? "Done" : "Not done"}
      className="mt-1.5 size-3.5 shrink-0 accent-accent"
    />
  );
}

const RENDERERS: Renderers = {
  paragraph: (node, context) => <p className={PROSE_WIDTH}>{renderChildren(node.children, context)}</p>,
  heading: renderHeading,
  blockquote: (node, context) => (
    <blockquote className={`${PROSE_WIDTH} border-l-2 border-border-strong pl-3 text-fg-muted ${NESTED_STACK}`}>
      {renderChildren(node.children, context)}
    </blockquote>
  ),
  list: (node, context) => {
    const items = renderChildren(node.children, context);
    return node.ordered === true ? (
      <ol start={node.start ?? undefined} className={`${LIST_STYLE} list-decimal`}>
        {items}
      </ol>
    ) : (
      <ul className={`${LIST_STYLE} list-disc`}>{items}</ul>
    );
  },
  listItem: (node, context) =>
    typeof node.checked === "boolean" ? (
      <li className="-ml-5 flex list-none items-start gap-2">
        {renderTaskBox(node.checked)}
        <div className={`min-w-0 flex-1 ${NESTED_STACK}`}>{renderChildren(node.children, context)}</div>
      </li>
    ) : (
      <li className={NESTED_STACK}>{renderChildren(node.children, context)}</li>
    ),
  code: (node, context) => <CodeBlock code={node.value} language={node.lang ?? null} open={context.caret} />,
  table: renderTable,
  tableRow: (node, context) => <>{renderChildren(node.children, context)}</>,
  tableCell: (node, context) => <>{renderChildren(node.children, context)}</>,
  thematicBreak: () => <hr className="border-border" />,
  definition: (node) => (
    <p className="text-xs text-fg-subtle">
      [{node.label ?? node.identifier}]: {node.url}
    </p>
  ),
  footnoteDefinition: (node, context) => (
    <div className={`text-xs text-fg-muted ${NESTED_STACK}`}>
      <span className="text-fg-subtle">[{node.label ?? node.identifier}]</span> {renderChildren(node.children, context)}
    </div>
  ),
  yaml: (node) => <pre className={RAW_TEXT}>{node.value}</pre>,
  html: (node, context) =>
    LINE_BREAK_TAG.test(node.value.trim()) ? <br /> : withCaret(<span className={RAW_TEXT}>{node.value}</span>, context),
  text: (node, context) => renderText(node.value, context),
  emphasis: (node, context) => <em>{renderChildren(node.children, context)}</em>,
  strong: (node, context) => <strong className="font-semibold">{renderChildren(node.children, context)}</strong>,
  delete: (node, context) => <del className="text-fg-muted">{renderChildren(node.children, context)}</del>,
  inlineCode: (node, context) => renderInlineCode(node.value, context),
  break: () => <br />,
  link: (node, context) => renderLink(node.url, node.children, context),
  linkReference: (node, context) => renderChildren(node.children, context),
  image: (node, context) => renderImage(node.url, node.alt, context),
  imageReference: (node, context) => withCaret(<span className="text-fg-muted">{node.alt ?? node.identifier}</span>, context),
  footnoteReference: (node, context) =>
    withCaret(<sup className="text-fg-subtle">[{node.label ?? node.identifier}]</sup>, context),
};

function render<K extends keyof RootContentMap>(type: K, node: RootContentMap[K], context: Context): ReactNode {
  return RENDERERS[type](node, context);
}

function renderNode(node: RootContent, context: Context): ReactNode {
  return render(node.type, node, context);
}

interface MarkdownNodeProps {
  node: RootContent;
  caret: boolean;
}

/** One top-level block. Settled blocks keep their `node`, so memoising on it skips them while a reply streams. */
export const MarkdownNode = memo(function MarkdownNode({ node, caret }: MarkdownNodeProps) {
  return renderNode(node, { caret, inLink: false });
});
