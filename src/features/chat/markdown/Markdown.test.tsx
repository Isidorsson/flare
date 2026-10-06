import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The tooltip renders into document.body through a portal, which server rendering cannot do.
await mock.module("@/shared/ui/Tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

const { Markdown } = await import("./Markdown");
const { MarkdownServicesContext } = await import("./services");

const SERVICES = {
  openUrl: () => undefined,
  openFile: () => undefined,
  colorize: () => Promise.resolve(null),
};

function render(text: string, streaming = false): string {
  return renderToStaticMarkup(
    <MarkdownServicesContext value={SERVICES}>
      <Markdown text={text} streaming={streaming} />
    </MarkdownServicesContext>,
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("no raw html reaches the page", () => {
  test("html in the source is shown as text", () => {
    const html = render("<script>alert(1)</script>\n\nhello <img src=x onerror=alert(1)> <b>bold</b>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("a line-break tag in a table cell still breaks the line", () => {
    const html = render("| a |\n| --- |\n| one<br>two |");
    expect(html).toContain("one<br/>two");
  });

  test("markup characters in code stay text", () => {
    const html = render("```html\n<div onclick=\"x()\">&amp;</div>\n```");
    expect(html).not.toContain("<div onclick");
    expect(html).toContain("&lt;div onclick=");
  });

  test("an image is never loaded: remote ones become links, others their description", () => {
    const html = render("![logo](https://example.com/a.png) ![local](data:image/png;base64,AAAA)");
    expect(html).not.toContain("<img");
    expect(html).toContain('role="link"');
    expect(html).toContain("logo");
    expect(html).toContain("local");
  });
});

describe("links", () => {
  test("a web link is a link that has no href to navigate to", () => {
    const html = render("[docs](https://example.com/docs)");
    expect(html).toContain('role="link"');
    expect(html).toContain(">docs</a>");
    expect(html).not.toContain("href=");
  });

  test("script and file schemes render as plain text", () => {
    const html = render("[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) [c](file:///C:/x.exe) [d](#top)");
    expect(html).not.toContain('role="link"');
    expect(html).not.toContain("data-link");
    expect(html).not.toContain("href=");
    for (const label of ["a", "b", "c", "d"]) expect(html).toContain(label);
    expect(html).not.toContain("javascript");
  });

  test("a bare url in the text becomes a link", () => {
    const html = render("go to https://example.com now");
    expect(html).toContain('role="link"');
  });
});

describe("file references", () => {
  test("a path with a line in prose is a file reference", () => {
    const html = render("The bug is in src/foo.ts:42 today.");
    expect(html).toContain('data-link="file"');
    expect(html).toContain("src/foo.ts:42</span></a>");
  });

  test("an inline code span that names a file is a file reference around the code", () => {
    const html = render("Edit `Cargo.toml` and `console.log`.");
    expect(count(html, 'data-link="file"')).toBe(1);
    expect(html).toContain("Cargo.toml</code></a>");
  });

  test("a link to a path with a line opens the file", () => {
    const html = render("[foo.ts](src/foo.ts:42)");
    expect(html).toContain('data-link="file"');
    expect(html).toContain(">foo.ts</a>");
    expect(count(html, 'data-link="external"')).toBe(0);
  });

  test("a link never holds another clickable thing", () => {
    const html = render("[see src/foo.ts:42](https://example.com)");
    expect(count(html, 'data-link="file"')).toBe(0);
    expect(count(html, 'data-link="external"')).toBe(1);
  });
});

describe("github flavoured markdown", () => {
  test("headings, emphasis, strikethrough, inline code and blockquotes", () => {
    const html = render("# Title\n\n## Sub\n\n*em* **strong** ~~gone~~ `code`\n\n> quoted");
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<strong");
    expect(html).toContain("<del");
    expect(html).toContain("<code");
    expect(html).toContain("<blockquote");
  });

  test("lists, numbering that does not start at one, and task lists", () => {
    const html = render("- a\n- b\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo");
    expect(html).toContain("<ul");
    expect(html).toContain('<ol start="3"');
    expect(count(html, 'type="checkbox"')).toBe(2);
    expect(count(html, "checked")).toBe(1);
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain('aria-label="Not done"');
  });

  test("tables keep their header, rows and alignment", () => {
    const html = render("| name | n |\n| :--- | ---: |\n| a | 1 |\n| b | 2 |");
    expect(html).toContain("<table");
    expect(count(html, "<th ")).toBe(2);
    expect(count(html, "<td ")).toBe(4);
    expect(html).toContain("text-left");
    expect(html).toContain("text-right");
  });

  test("a single tilde is left alone", () => {
    const html = render("about ~5 min or ~10 min");
    expect(html).not.toContain("<del");
    expect(html).toContain("~5 min or ~10 min");
  });
});

describe("code blocks", () => {
  test("show the language, a copy button and the code without wrapping", () => {
    const html = render("```ts\nconst a = 1;\n```");
    expect(html).toContain("<figure");
    expect(html).toContain(">ts</span>");
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain("const a = 1;");
    expect(html).toContain("whitespace-pre");
    expect(html).toContain("overflow-x-auto");
  });

  test("a fence without a language is labelled as text", () => {
    expect(render("```\nplain\n```")).toContain(">text</span>");
  });
});

describe("while streaming", () => {
  test("an open code fence is already a code block with the caret inside it", () => {
    const html = render("Here:\n\n```ts\nconst a = 1;\nconst b", true);
    expect(html).toContain("<figure");
    expect(count(html, "animate-pulse")).toBe(1);
    expect(html.indexOf("animate-pulse")).toBeGreaterThan(html.indexOf("const b"));
  });

  test("half a table is already a table", () => {
    const html = render("| a | b |\n| --", true);
    expect(html).toContain("<table");
  });

  test("the caret sits at the end of the last paragraph and nowhere else", () => {
    const html = render("first\n\nsecond", true);
    expect(count(html, "animate-pulse")).toBe(1);
    expect(html.indexOf("animate-pulse")).toBeGreaterThan(html.indexOf("second"));
    expect(render("first\n\nsecond", false)).not.toContain("animate-pulse");
  });

  test("the caret follows a list into its last item", () => {
    const html = render("- a\n- b", true);
    expect(html.indexOf("animate-pulse")).toBeGreaterThan(html.indexOf(">b"));
  });
});
