import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { cleanHeadline, findJsonReply, removeTrailers, splitPlainReply, unfence } from "./reply-clean";

const schema = z.object({ title: z.string(), body: z.string().nullish() });

describe("findJsonReply", () => {
  test("reads bare, fenced and chatter wrapped JSON", () => {
    const json = '{"title":"a","body":"b"}';
    expect(findJsonReply(json, schema)).toEqual({ title: "a", body: "b" });
    expect(findJsonReply(`\`\`\`json\n${json}\n\`\`\``, schema)).toEqual({ title: "a", body: "b" });
    expect(findJsonReply(`Sure!\n${json}\nDone.`, schema)).toEqual({ title: "a", body: "b" });
  });

  test("gives up on text that is not JSON of the right shape", () => {
    expect(findJsonReply("fix: x", schema)).toBeUndefined();
    expect(findJsonReply('{"subject":"a"}', schema)).toBeUndefined();
    expect(findJsonReply('{"title":"a","bo', schema)).toBeUndefined();
    expect(findJsonReply('["a"]', schema)).toBeUndefined();
  });
});

describe("splitPlainReply", () => {
  test("splits the first line from the rest, inside a fence if there is one", () => {
    expect(splitPlainReply("a\n\nb\nc")).toEqual({ head: "a", rest: "\nb\nc" });
    expect(splitPlainReply("```\na\nb\n```")).toEqual({ head: "a", rest: "b" });
  });

  test("refuses text that starts like broken JSON", () => {
    expect(splitPlainReply('{"title":"a","bo')).toBeUndefined();
    expect(splitPlainReply('["a"]')).toBeUndefined();
  });
});

describe("unfence", () => {
  test("returns the content of the first fenced block or the trimmed text", () => {
    expect(unfence("x\n```ts\nconst a = 1;\n```\ny")).toBe("const a = 1;");
    expect(unfence("  plain  ")).toBe("plain");
  });
});

describe("cleanHeadline", () => {
  test("keeps the first line, drops the label, quotes and trailing periods", () => {
    expect(cleanHeadline('  Title: "fix:   x." \nmore', /^title\s*:\s*/i)).toBe("fix: x");
  });
});

describe("removeTrailers", () => {
  test("drops trailer lines, normalises line endings and collapses blank runs", () => {
    const raw = "one\r\n\r\n\r\n\r\ntwo\r\nCo-Authored-By: A <a@b.c>\r\n\u{1F916} Generated with Claude Code";
    expect(removeTrailers(raw)).toBe("one\n\ntwo");
  });

  test("keeps prose that merely mentions a trailer", () => {
    expect(removeTrailers("Stop adding Co-Authored-By lines.")).toBe("Stop adding Co-Authored-By lines.");
  });
});
