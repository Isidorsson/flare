import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { act, type ReactNode } from "react";

import type { ColorizedLine } from "@/features/files";

import { COPY_FEEDBACK_MS } from "./copy-machine";
import type { FileTarget } from "./file-refs";

// React reads the DOM globals once when it loads, so they must exist before react-dom/client is imported.
GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  await GlobalRegistrator.unregister();
});

// The tooltip needs the popover API, which is not what these tests are about.
await mock.module("@/shared/ui/Tooltip", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

const { createRoot } = await import("react-dom/client");
const { Markdown } = await import("./Markdown");
const { MarkdownServicesContext } = await import("./services");

const opened: string[] = [];
const openedFiles: FileTarget[] = [];
const copied: string[] = [];

Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: (text: string) => {
      copied.push(text);
      return Promise.resolve();
    },
  },
});

function colourEveryLine(code: string): Promise<ColorizedLine[]> {
  return Promise.resolve(code.split("\n").map((line) => (line === "" ? [] : [{ text: line, className: "mtk6" }])));
}

const SERVICES = {
  openUrl: (url: string) => opened.push(url),
  openFile: (target: FileTarget) => openedFiles.push(target),
  colorize: colourEveryLine,
};

// Runs `change` and lets React and the promises it started (like colouring code) finish.
function settle(change: () => void) {
  return act(async () => {
    change();
    await Promise.resolve();
  });
}

function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const show = (text: string, streaming: boolean) =>
    settle(() => {
      root.render(
        <MarkdownServicesContext value={SERVICES}>
          <Markdown text={text} streaming={streaming} />
        </MarkdownServicesContext>,
      );
    });
  return { container, show };
}

function click(element: Element | null | undefined) {
  return settle(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("streaming in a real DOM", () => {
  test("blocks that are done stay mounted while the tail grows, and the caret goes when it ends", async () => {
    const { container, show } = mount();
    await show("# Title\n\nfirst par", true);
    const heading = container.querySelector("h1");
    expect(container.querySelectorAll("p")[0]?.textContent).toContain("first par");

    await show("# Title\n\nfirst paragraph done\n\nsecond", true);
    expect(container.querySelector("h1")).toBe(heading);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);

    await show("# Title\n\nfirst paragraph done\n\nsecond", false);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
    expect(container.querySelector("h1")).toBe(heading);
  });

  test("code reads as the code at every step and is coloured line by line", async () => {
    const { container, show } = mount();
    await show("```ts\nconst a = 1;\nconst b", true);
    expect(container.querySelector("code")?.textContent).toBe("const a = 1;\nconst b");
    expect(container.querySelectorAll("code .mtk6")).toHaveLength(1);

    await show("```ts\nconst a = 1;\nconst b = 2;\n```", false);
    expect(container.querySelector("code")?.textContent).toBe("const a = 1;\nconst b = 2;");
    expect(container.querySelectorAll("code .mtk6")).toHaveLength(2);
  });
});

describe("clicking", () => {
  test("a web link goes to the opener and a file reference opens the file at its line", async () => {
    const { container, show } = mount();
    await show("See [docs](https://example.com/x) and src/foo.ts:42 and [bar](src/bar.ts:7).", false);

    await click(container.querySelector('[data-link="external"]'));
    expect(opened).toEqual(["https://example.com/x"]);

    const references = container.querySelectorAll('[data-link="file"]');
    expect(references).toHaveLength(2);
    for (const reference of references) await click(reference);
    expect(openedFiles).toEqual([
      { path: "src/foo.ts", line: 42, column: null },
      { path: "src/bar.ts", line: 7, column: null },
    ]);
  });

  test("Enter activates a focused link", async () => {
    const { container, show } = mount();
    await show("[docs](https://example.com/y)", false);
    await settle(() => {
      const link = container.querySelector('[data-link="external"]');
      link?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(opened).toContain("https://example.com/y");
  });

  test("a link has no href, so there is nothing for the webview to navigate to", async () => {
    const { container, show } = mount();
    await show("[docs](https://example.com/x) [bad](javascript:alert(1))", false);
    expect(container.querySelectorAll("[href]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="link"]')).toHaveLength(1);
  });
});

describe("the copy button", () => {
  test("copies exactly the code, says so for a moment, then offers to copy again", async () => {
    const { container, show } = mount();
    await show("```ts\nconst a = 1;\n\nconst b = 2;\n```", false);

    await click(container.querySelector('button[aria-label="Copy code"]'));
    expect(copied).toEqual(["const a = 1;\n\nconst b = 2;"]);
    expect(container.querySelector('button[aria-label="Copied"]')).not.toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, COPY_FEEDBACK_MS + 100));
    });
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  });
});
