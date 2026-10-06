import { dirname } from "node:path";

import { describe, expect, test } from "bun:test";
import { compile } from "tailwindcss";

const tokensCss = await Bun.file(new URL("./tokens.css", import.meta.url)).text();

async function loadStylesheet(id: string, base: string) {
  const path = Bun.resolveSync(id.endsWith(".css") ? id : `${id}.css`, base);
  return { path, base: dirname(path), content: await Bun.file(path).text() };
}

async function buildUtilities(candidates: string[]): Promise<string> {
  const source = `@import "tailwindcss/theme";\n${tokensCss}\n@tailwind utilities;`;
  const compiler = await compile(source, { base: import.meta.dir, loadStylesheet });
  return compiler.build(candidates);
}

describe("design tokens", () => {
  test("emit every token as a CSS custom property", async () => {
    const css = await buildUtilities([]);

    for (const token of ["--color-bg", "--color-surface-1", "--color-fg", "--color-accent", "--font-sans"]) {
      expect(css).toContain(`${token}:`);
    }
  });

  test("drive Tailwind colour utilities", async () => {
    const css = await buildUtilities(["bg-surface-2", "text-fg-muted", "border-border", "text-accent"]);

    expect(css).toContain("background-color: var(--color-surface-2)");
    expect(css).toContain("color: var(--color-fg-muted)");
    expect(css).toContain("border-color: var(--color-border)");
    expect(css).toContain("color: var(--color-accent)");
  });

  test("replace Tailwind's default palette", async () => {
    const css = await buildUtilities(["bg-red-500", "text-slate-200"]);

    expect(css).not.toContain("--color-red-500");
    expect(css).not.toContain("--color-slate-200");
    expect(css).not.toContain("background-color");
  });
});
