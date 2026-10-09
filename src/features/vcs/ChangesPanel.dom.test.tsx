import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { buttonLabelled, press, settle, typeInto } from "./dom-test-support";
import { NOT_A_REPO, createFakeGateway, file, repoStatus, type FakeGateway, type FakeOptions } from "./fake-gateway";
import { generator } from "./store-test-support";
import type { VcsState, VcsStore } from "./vcs-store";
import { createVcsStore } from "./vcs-store";

// React reads the DOM globals once when it loads, so they must exist before react-dom/client is imported.
GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  await GlobalRegistrator.unregister();
});

// The panels read one app-wide store that talks to Tauri; each test brings its own over a fake gateway.
let current: VcsStore = createVcsStore({ gateway: createFakeGateway().gateway });
function useVcs<T>(selector: (state: VcsState) => T): T {
  return useStore(current, selector);
}
await mock.module("./use-vcs", () => ({ useVcs }));
// Monaco does not run without a browser: stand in for the diff editor with the two texts it would compare.
await mock.module("@/features/files/MonacoDiffView", () => ({
  MonacoDiffView: ({ entry }: { entry: { before: string | null; after: string } }): ReactNode => (
    <pre data-testid="diff">{`${entry.before ?? "(none)"} => ${entry.after}`}</pre>
  ),
}));
HTMLElement.prototype.hidePopover = () => undefined;

const { createRoot } = await import("react-dom/client");
const { ChangesPanel } = await import("./ChangesPanel");

const ROOT = "C:/work/app";
const FILES = [file("src/a.ts", null, "modified"), file("notes.md", null, "untracked"), file("src/b.ts", "modified", null)];

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

async function mountPanel(options: FakeOptions & { root?: string | null } = {}) {
  const { root = ROOT, ...fakeOptions } = options;
  const fake: FakeGateway = createFakeGateway({ status: repoStatus({ files: FILES }), ...fakeOptions });
  current = createVcsStore({ gateway: fake.gateway });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const reactRoot = createRoot(container);
  await settle(() => {
    reactRoot.render(<ChangesPanel />);
  });
  await settle(() => {
    void current.getState().setRoot(root);
  });
  return { fake, container, store: current, text: () => container.textContent };
}

function rowOf(container: HTMLElement, fileName: string, section: string): HTMLElement {
  const list = container.querySelector(`section[aria-label="${section}"]`);
  const row = [...(list?.querySelectorAll("li") ?? [])].find((item) => item.textContent.includes(fileName));
  if (row === undefined) throw new Error(`no row ${fileName} under ${section}`);
  return row;
}

function subjectInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Commit subject"]');
  if (input === null) throw new Error("no subject field");
  return input;
}

describe("the states around a repository", () => {
  test("asks for a folder when none is open", async () => {
    const { text } = await mountPanel({ root: null });
    expect(text()).toContain("No folder open");
  });

  test("says git is not set up in a folder that is not a repository", async () => {
    const { text, container } = await mountPanel({ status: NOT_A_REPO });
    expect(text()).toContain("Git is not set up in this folder");
    expect(container.querySelector("input")).toBeNull();
  });

  test("shows the failure and a way to retry when git cannot be read", async () => {
    let fail = true;
    const { container, text, fake } = await mountPanel({
      overrides: { status: () => (fail ? Promise.reject(new Error("git is not installed")) : Promise.resolve(repoStatus({ files: FILES }))) },
    });
    expect(text()).toContain("git is not installed");

    fail = false;
    await press(buttonLabelled(container, "Try again"));
    expect(text()).not.toContain("git is not installed");
    expect(text()).toContain("main");
    expect(fake.calls.filter((call) => call === "status")).toHaveLength(2);
  });
});

describe("the file lists", () => {
  test("shows Staged and Changes with their counts, the branch and each file's letter", async () => {
    const { container, text } = await mountPanel();
    expect(text()).toContain("main");
    expect(container.querySelector('section[aria-label="Staged"]')?.textContent).toContain("b.ts");
    const changes = container.querySelector('section[aria-label="Changes"]');
    expect(changes?.textContent).toContain("a.ts");
    expect(changes?.textContent).toContain("notes.md");
    expect(rowOf(container, "notes.md", "Changes").textContent).toContain("U");
    expect(rowOf(container, "a.ts", "Changes").textContent).toContain("M");
  });

  test("says the working tree is clean when nothing changed", async () => {
    const { text } = await mountPanel({ status: repoStatus() });
    expect(text()).toContain("The working tree is clean");
  });

  test("stages a file from its row and lists it under Staged", async () => {
    const { container, fake } = await mountPanel();
    await press(buttonLabelled(rowOf(container, "a.ts", "Changes"), "Stage"));

    expect(fake.calls).toContain("stage src/a.ts");
    expect(container.querySelector('section[aria-label="Staged"]')?.textContent).toContain("a.ts");
    expect(container.querySelector('section[aria-label="Changes"]')?.textContent).not.toContain("a.ts");
  });

  test("stages everything and unstages everything", async () => {
    const { container, fake } = await mountPanel();
    await press(buttonLabelled(container, "Stage all"));
    expect(fake.calls).toContain("stage (all)");
    expect(container.querySelector('section[aria-label="Changes"]')).toBeNull();

    await press(buttonLabelled(container, "Unstage all"));
    expect(fake.calls).toContain("unstage (all)");
    expect(container.querySelector('section[aria-label="Staged"]')).toBeNull();
  });

  test("an untracked file cannot be discarded and the button says why", async () => {
    const { container } = await mountPanel();
    const discard = buttonLabelled(rowOf(container, "notes.md", "Changes"), "Discard changes");
    expect(discard.getAttribute("aria-disabled")).toBe("true");
    expect(container.ownerDocument.body.textContent).toContain("nothing to restore");
  });

  test("discarding asks first and only then goes back to the index", async () => {
    const { container, fake } = await mountPanel();
    await press(buttonLabelled(rowOf(container, "a.ts", "Changes"), "Discard changes"));
    const dialog = container.querySelector("dialog");
    expect(dialog?.textContent).toContain("Discard changes to a.ts?");
    expect(fake.calls.some((call) => call.startsWith("discard"))).toBe(false);

    if (dialog === null) throw new Error("no dialog");
    await press(buttonLabelled(dialog, "Discard changes"));
    expect(fake.calls).toContain("discard src/a.ts");
    expect(container.querySelector("dialog")).toBeNull();
  });

  test("cancelling the question leaves the file alone", async () => {
    const { container, fake } = await mountPanel();
    await press(buttonLabelled(rowOf(container, "a.ts", "Changes"), "Discard changes"));
    const dialog = container.querySelector("dialog");
    if (dialog === null) throw new Error("no dialog");
    await press(buttonLabelled(dialog, "Cancel"));

    expect(container.querySelector("dialog")).toBeNull();
    expect(fake.calls.some((call) => call.startsWith("discard"))).toBe(false);
  });

  test("a failed action shows its error in the list and the error can be dismissed", async () => {
    const { container, text } = await mountPanel({ overrides: { stage: () => Promise.reject(new Error("index.lock exists")) } });
    await press(buttonLabelled(rowOf(container, "a.ts", "Changes"), "Stage"));
    expect(text()).toContain("Could not stage.");
    expect(text()).toContain("index.lock exists");

    await press(buttonLabelled(container, "Dismiss this message"));
    expect(text()).not.toContain("index.lock exists");
  });
});

describe("the diff", () => {
  test("asks to pick a file at first, then shows the two texts of the one picked", async () => {
    const { container, text, fake } = await mountPanel();
    expect(text()).toContain("Pick a file to see its changes");

    await press(rowOf(container, "a.ts", "Changes").querySelector("button") ?? container);
    expect(fake.calls).toContain("diff unstaged src/a.ts");
    expect(container.querySelector('[data-testid="diff"]')?.textContent).toBe("old\n => new\n");
  });

  test("a binary file gets a notice instead of an editor", async () => {
    const { container, text } = await mountPanel({
      diffs: { "unstaged:src/a.ts": { path: "src/a.ts", original: null, modified: null, binary: true } },
    });
    await press(rowOf(container, "a.ts", "Changes").querySelector("button") ?? container);
    expect(text()).toContain("Binary or too large");
    expect(container.querySelector('[data-testid="diff"]')).toBeNull();
  });

  test("a diff that cannot be read says so", async () => {
    const { container, text } = await mountPanel({ overrides: { fileDiff: () => Promise.reject(new Error("bad object")) } });
    await press(rowOf(container, "a.ts", "Changes").querySelector("button") ?? container);
    expect(text()).toContain("Could not load the diff: bad object");
  });
});

describe("committing", () => {
  test("Commit explains what is missing until there is a subject", async () => {
    const { container } = await mountPanel();
    const commit = buttonLabelled(container, "Commit");
    expect(commit.getAttribute("aria-disabled")).toBe("true");
    expect(container.ownerDocument.body.textContent).toContain("Write a commit subject first");

    await press(commit);
    await typeInto(subjectInput(container), "feat: add it");
    expect(buttonLabelled(container, "Commit").getAttribute("aria-disabled")).toBeNull();
  });

  test("Commit explains that nothing is staged", async () => {
    const { container } = await mountPanel({ status: repoStatus({ files: [file("a.ts", null, "modified")] }) });
    await typeInto(subjectInput(container), "feat: add it");
    expect(buttonLabelled(container, "Commit").getAttribute("aria-disabled")).toBe("true");
    expect(container.ownerDocument.body.textContent).toContain("Stage at least one file to commit");
  });

  test("commits the typed message and empties the fields", async () => {
    const { container, fake } = await mountPanel();
    await typeInto(subjectInput(container), "feat: add it");
    const description = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit description"]');
    if (description === null) throw new Error("no description field");
    await typeInto(description, "Because.");
    await press(buttonLabelled(container, "Commit"));

    expect(fake.calls).toContain(`commit ${JSON.stringify("feat: add it\n\nBecause.")}`);
    expect(subjectInput(container).value).toBe("");
    expect(description.value).toBe("");
  });

  test("Ctrl+Enter in the subject field commits", async () => {
    const { container, fake } = await mountPanel();
    const input = subjectInput(container);
    await typeInto(input, "fix: quick");
    await settle(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(fake.calls).toContain(`commit ${JSON.stringify("fix: quick")}`);
  });

  test("Commit & Push commits and pushes", async () => {
    const { container, fake } = await mountPanel();
    await typeInto(subjectInput(container), "feat: ship");
    await press(buttonLabelled(container, "Commit & Push"));
    expect(fake.calls.slice(-2)).toEqual([`commit ${JSON.stringify("feat: ship")}`, "push"]);
  });

  test("counts the subject's characters and warns past 72", async () => {
    const { container } = await mountPanel();
    await typeInto(subjectInput(container), "x".repeat(73));
    const counter = container.querySelector('[aria-label="73 of 72 characters"]');
    expect(counter?.textContent).toBe("73/72");
    expect(counter?.className).toContain("text-warning");
  });
});

describe("generating a message", () => {
  test("is explained as unavailable until a generator is configured, then fills the fields", async () => {
    const { container, store, fake } = await mountPanel();
    const generate = buttonLabelled(container, "Generate");
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    expect(container.ownerDocument.body.textContent).toContain("Commit message generation is not connected yet");

    await settle(() => {
      store.getState().configure(generator().generate);
    });
    expect(buttonLabelled(container, "Generate").getAttribute("aria-disabled")).toBeNull();
    await press(buttonLabelled(container, "Generate"));

    expect(fake.calls).toContain("messageContext");
    expect(subjectInput(container).value).toBe("feat(files): add diffs");
  });

  test("the toggle asks for a description as well", async () => {
    const { container, store } = await mountPanel();
    const { generate, inputs } = generator();
    await settle(() => {
      store.getState().configure(generate);
    });
    await press(buttonLabelled(container, "with description"));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    await press(buttonLabelled(container, "Generate"));

    expect(inputs[0]?.includeBody).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Commit description"]')?.value).toBe("Why.");
  });

  test("a failure of the generator is shown next to the fields", async () => {
    const { container, store, text } = await mountPanel();
    await settle(() => {
      store.getState().configure(() => Promise.reject(new Error("the bridge is not running")));
    });
    await press(buttonLabelled(container, "Generate"));
    expect(text()).toContain("Could not generate a message.");
    expect(text()).toContain("the bridge is not running");
  });
});

describe("branches and syncing", () => {
  test("Pull and Push explain why they are unavailable", async () => {
    const { container } = await mountPanel({ status: repoStatus({ upstream: null, files: FILES }) });
    const pull = buttonLabelled(container, "Pull");
    expect(pull.getAttribute("aria-disabled")).toBe("true");
    expect(container.ownerDocument.body.textContent).toContain("no upstream to pull from");

    const inStep = await mountPanel({ status: repoStatus({ files: FILES }) });
    expect(buttonLabelled(inStep.container, "Push").getAttribute("aria-disabled")).toBe("true");
    expect(inStep.container.ownerDocument.body.textContent).toContain("No commits to push");
  });

  test("shows how far the branch is from its upstream", async () => {
    const { text } = await mountPanel({ status: repoStatus({ ahead: 2, behind: 1, files: FILES }) });
    expect(text()).toContain("↑2 ↓1");
  });

  test("Fetch, Pull and Push call git", async () => {
    const { container, fake } = await mountPanel({ status: repoStatus({ ahead: 1, behind: 1, files: FILES }) });
    await press(buttonLabelled(container, "Fetch"));
    await press(buttonLabelled(container, "Pull"));
    await press(buttonLabelled(container, "Push"));
    expect(fake.calls.slice(-3)).toEqual(["fetch", "pull", "push"]);
  });

  test("lists local branches and the remote ones without a local copy, and switches on a click", async () => {
    const { container, store, fake } = await mountPanel();
    await settle(() => {
      void store.getState().loadBranches();
    });
    const menu = container.querySelector('[aria-label="Branches"]');
    if (menu === null) throw new Error("no branch menu");
    expect(menu.querySelector('section[aria-label="Local"]')?.textContent).toContain("dev");
    expect(menu.querySelector('section[aria-label="Remote"]')?.textContent).toContain("origin/feature");
    expect(menu.querySelector('section[aria-label="Remote"]')?.textContent).not.toContain("origin/main");

    const dev = [...menu.querySelectorAll("li")].find((item) => item.textContent.trim() === "dev");
    await press(dev?.querySelector("button") ?? menu);
    expect(fake.calls).toContain("switch dev");
  });

  test("creating a branch needs a valid name", async () => {
    const { container, store, fake } = await mountPanel();
    await settle(() => {
      void store.getState().loadBranches();
    });
    const menu = container.querySelector('[aria-label="Branches"]');
    if (menu === null) throw new Error("no branch menu");
    const name = menu.querySelector<HTMLInputElement>('input[aria-label="New branch name"]');
    if (name === null) throw new Error("no new branch form");

    expect(buttonLabelled(menu, "Create").getAttribute("aria-disabled")).toBe("true");
    await typeInto(name, "two words");
    expect(menu.textContent).toContain("cannot contain spaces");
    await typeInto(name, "feature/login");
    expect(buttonLabelled(menu, "Create").getAttribute("aria-disabled")).toBeNull();
    await press(buttonLabelled(menu, "Create"));
    expect(fake.calls).toContain("create feature/login");
  });

  test("deleting a branch asks first and can force the deletion", async () => {
    const { container, store, fake } = await mountPanel();
    await settle(() => {
      void store.getState().loadBranches();
    });
    const menu = container.querySelector('[aria-label="Branches"]');
    if (menu === null) throw new Error("no branch menu");
    const dev = [...menu.querySelectorAll("li")].find((item) => item.textContent.trim() === "dev");
    await press(buttonLabelled(dev ?? menu, "Delete this branch"));

    const dialog = menu.querySelector("dialog");
    if (dialog === null) throw new Error("no dialog");
    expect(dialog.textContent).toContain("Delete branch dev?");
    expect(fake.calls.some((call) => call.startsWith("delete"))).toBe(false);

    const force = dialog.querySelector('input[type="checkbox"]');
    await press(force ?? dialog);
    await press(buttonLabelled(dialog, "Delete branch"));
    expect(fake.calls).toContain("delete dev force=true");
  });
});
