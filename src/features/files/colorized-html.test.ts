import { describe, expect, test } from "bun:test";

import { parseColorizedHtml } from "./colorized-html";

const NBSP = "\u00a0";

describe("parseColorizedHtml", () => {
  test("turns Monaco's per-line spans into lines of classed text", () => {
    const html =
      `<span><span class="mtk6">const</span><span class="mtk1">${NBSP}x${NBSP}=${NBSP}</span><span class="mtk7">1</span></span><br/>` +
      `<span><span class="mtk1">y</span></span><br/>`;
    expect(parseColorizedHtml(html)).toEqual([
      [
        { text: "const", className: "mtk6" },
        { text: " x = ", className: "mtk1" },
        { text: "1", className: "mtk7" },
      ],
      [{ text: "y", className: "mtk1" }],
    ]);
  });

  test("decodes the entities Monaco escapes and turns non-breaking spaces back into spaces", () => {
    const html = `<span><span class="mtk1">a${NBSP}&lt;b&gt;${NBSP}&amp;${NBSP}c&#00;</span></span><br/>`;
    expect(parseColorizedHtml(html)).toEqual([[{ text: "a <b> & c\u0000", className: "mtk1" }]]);
  });

  test("keeps blank lines, including a final one after a trailing newline", () => {
    const html = "<span><span>a</span></span><br/><span><span></span></span><br/><span><span></span></span><br/>";
    expect(parseColorizedHtml(html)).toEqual([[{ text: "a", className: "" }], [], []]);
  });

  test("keeps style modifiers and ignores inline styles", () => {
    const html = `<span><span style="width:16px" class="mtk3 mtki mtkb">x</span></span><br/>`;
    expect(parseColorizedHtml(html)).toEqual([[{ text: "x", className: "mtk3 mtki mtkb" }]]);
  });

  test("an empty snippet is one empty line", () => {
    expect(parseColorizedHtml("<span><span></span></span><br/>")).toEqual([[]]);
  });

  test("rejects markup it does not know", () => {
    expect(() => parseColorizedHtml(`<span><img src=x onerror=alert(1)></span><br/>`)).toThrow("Unexpected markup");
    expect(() => parseColorizedHtml(`<span><script>1</script></span><br/>`)).toThrow("Unexpected markup");
  });

  test("rejects token classes that are not Monaco's", () => {
    expect(() => parseColorizedHtml(`<span><span class="mtk1 evil">x</span></span><br/>`)).toThrow("Unexpected class");
    expect(() => parseColorizedHtml(`<span><span class="x">x</span></span><br/>`)).toThrow("Unexpected class");
  });
});
