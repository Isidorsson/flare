import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useStore } from "zustand";

import { buttonLabelled, chooseOption, press, settle, typeInto } from "./dom-test-support";
import { DEFAULT_PR_CONTEXT, DEFAULT_PR_INFO, pullRequest } from "./fake-pr-gateway";
import { createFakeGateway, deferred, type FakeOptions } from "./fake-gateway";
import { FEATURE, prGenerator } from "./store-test-support";
import { VcsCommandError, type PrCreateResult, type PrInfo } from "./vcs-schemas";
import type { VcsState, VcsStore } from "./vcs-store";
import { createVcsStore } from "./vcs-store";
import type { GeneratedPullRequest } from "./vcs-types";

// React reads the DOM globals once when it loads, so they must exist before react-dom/client is imported.
GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => {
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  await GlobalRegistrator.unregister();
});

// The section reads one app-wide store that talks to Tauri; each test brings its own over a fake gateway.
let current: VcsStore = createVcsStore({ gateway: createFakeGateway().gateway });
function useVcs<T>(selector: (state: VcsState) => T): T {
  return useStore(current, selector);
}
const openedUrls: string[] = [];
await mock.module("./use-vcs", () => ({ useVcs }));
await mock.module("./open-url", () => ({
  openInBrowser: (url: string) => {
    openedUrls.push(url);
  },
}));

const { createRoot } = await import("react-dom/client");
const { PullRequestSection } = await import("./PullRequestSection");

const ROOT = "C:/work/app";
const GH_MISSING: PrInfo = { ghAvailable: false, authenticated: false, defaultBase: null, current: null };

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
  openedUrls.length = 0;
});

async function mountSection(options: FakeOptions = {}) {
  const fake = createFakeGateway({ status: FEATURE, ...options });
  current = createVcsStore({ gateway: fake.gateway });
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const reactRoot = createRoot(container);
  await settle(() => {
    reactRoot.render(<PullRequestSection />);
  });
  await settle(() => {
    void current.getState().setRoot(ROOT);
  });
  await settle();
  return { fake, container, store: current, text: () => container.textContent, tips: () => document.body.textContent };
}

function section(container: HTMLElement): HTMLElement | null {
  return container.querySelector('section[aria-label="Pull request"]');
}

function header(container: HTMLElement): HTMLButtonElement {
  return required(container.querySelector<HTMLButtonElement>("button[aria-expanded]"), "section header");
}

async function mountOpen(options: FakeOptions = {}) {
  const mounted = await mountSection(options);
  await press(header(mounted.container));
  return mounted;
}

function required<T extends Element>(found: T | null, what: string): T {
  if (found === null) throw new Error(`no ${what}`);
  return found;
}

const titleInput = (container: HTMLElement) =>
  required(container.querySelector<HTMLInputElement>('input[aria-label="Pull request title"]'), "title field");
const bodyInput = (container: HTMLElement) =>
  required(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pull request description"]'), "description field");
const basePicker = (container: HTMLElement) =>
  required(container.querySelector<HTMLSelectElement>('select[aria-label="Base branch"]'), "base picker");

describe("when the section is there", () => {
  test("it is not on the default branch, on a detached HEAD or outside a repository", async () => {
    expect(section((await mountSection({ status: { ...FEATURE, branch: "main" } })).container)).toBeNull();
    expect(section((await mountSection({ status: { ...FEATURE, branch: null } })).container)).toBeNull();
    expect(section((await mountSection({ status: { ...FEATURE, isRepo: false, branch: null } })).container)).toBeNull();
  });

  test("it starts closed and opens on a click on its header", async () => {
    const { container } = await mountSection();
    expect(header(container).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("input")).toBeNull();

    await press(header(container));
    expect(header(container).getAttribute("aria-expanded")).toBe("true");
    expect(titleInput(container).value).toBe("");

    await press(header(container));
    expect(container.querySelector("input")).toBeNull();
  });
});

describe("a look-up that failed", () => {
  test("is marked on the closed header, read once open and retried with a button", async () => {
    let failing = true;
    const { container, text, tips } = await mountSection({
      overrides: { prInfo: () => (failing ? Promise.reject(new Error("gh crashed")) : Promise.resolve(DEFAULT_PR_INFO)) },
    });
    expect(tips()).toContain("Something went wrong");

    await press(header(container));
    expect(text()).toContain("Could not read the pull request state.");
    expect(text()).toContain("gh crashed");

    failing = false;
    await press(buttonLabelled(container, "Try again"));
    expect(text()).not.toContain("gh crashed");
    expect(titleInput(container).value).toBe("");
  });
});

describe("the GitHub CLI", () => {
  test("a missing one comes with the install command and the need to restart", async () => {
    const { container, text } = await mountOpen({ prInfo: GH_MISSING });
    expect(text()).toContain("The GitHub CLI is not installed");
    expect(container.querySelector("code")?.textContent).toBe("winget install GitHub.cli");
    expect(text()).toContain("restart Flare");
    expect(container.querySelector("input")).toBeNull();
  });

  test("a signed-out one comes with the login command and a way to check again", async () => {
    const { container, text, fake } = await mountOpen({ prInfo: { ...DEFAULT_PR_INFO, authenticated: false, defaultBase: null } });
    expect(text()).toContain("The GitHub CLI is not signed in");
    expect(container.querySelector("code")?.textContent).toBe("gh auth login");

    await press(buttonLabelled(container, "Check again"));
    expect(fake.ghCalls).toEqual(["prInfo", "prInfo"]);
  });

  test("the command can be copied, and the button says what it does", async () => {
    const { container, tips } = await mountOpen({ prInfo: GH_MISSING });
    expect(buttonLabelled(container, "Copy the command").getAttribute("aria-describedby")).not.toBeNull();
    expect(tips()).toContain("Puts the command on the clipboard");
  });
});

describe("a branch that already has a pull request", () => {
  const withPr = (overrides = {}): FakeOptions => ({ prInfo: { ...DEFAULT_PR_INFO, current: pullRequest(overrides) } });

  test("shows its number, title and state, and no form", async () => {
    const { container, text } = await mountOpen(withPr());
    expect(text()).toContain("#42 feat(auth): add login");
    expect(text()).toContain("into main");
    expect(container.querySelector("input")).toBeNull();
    expect(header(container).textContent).toContain("#42 open");
  });

  test("tells draft, merged and closed apart", async () => {
    for (const [overrides, label] of [
      [{ isDraft: true }, "draft"],
      [{ state: "merged" }, "merged"],
      [{ state: "closed" }, "closed"],
    ] as const) {
      const { container } = await mountOpen(withPr(overrides));
      expect(header(container).textContent).toContain(`#42 ${label}`);
      expect(container.querySelector('[tabindex="0"]')?.textContent).toBe(label);
    }
  });

  test("Open in browser sends the address to the opener", async () => {
    const { container } = await mountOpen(withPr());
    await press(buttonLabelled(container, "Open in browser"));
    expect(openedUrls).toEqual(["https://github.com/acme/app/pull/42"]);
  });

  test("the header shows the number and state even while the section is closed", async () => {
    const { container } = await mountSection(withPr());
    expect(header(container).textContent).toContain("#42 open");
    expect(container.querySelector("code")).toBeNull();
  });
});

describe("the form", () => {
  test("offers the default base first and the other branches after it", async () => {
    const { container } = await mountOpen();
    const picker = basePicker(container);
    expect([...picker.options].map((option) => option.value)).toEqual(["main", "dev", "feature"]);
    expect(picker.value).toBe("main");
  });

  test("a base that was picked goes into the pull request", async () => {
    const { container, fake } = await mountOpen();
    await chooseOption(basePicker(container), "dev");
    await typeInto(titleInput(container), "feat: login");
    await press(buttonLabelled(container, "Create PR"));
    expect(fake.ghCalls.at(-1)).toBe(`prCreate dev draft=false ${JSON.stringify("feat: login")}`);
  });

  test("counts the title's characters and warns past 72", async () => {
    const { container } = await mountOpen();
    await typeInto(titleInput(container), "x".repeat(73));
    const counter = container.querySelector('[aria-label="73 of 72 title characters"]');
    expect(counter?.textContent).toBe("73/72");
    expect(counter?.className).toContain("text-warning");
  });

  test("Create PR says a title is missing until there is one", async () => {
    const { container, fake, tips } = await mountOpen();
    const create = buttonLabelled(container, "Create PR");
    expect(create.getAttribute("aria-disabled")).toBe("true");
    expect(tips()).toContain("Write a pull request title first");

    await press(create);
    expect(fake.ghCalls).toEqual(["prInfo"]);

    await typeInto(titleInput(container), "feat: login");
    expect(buttonLabelled(container, "Create PR").getAttribute("aria-disabled")).toBeNull();
  });

  test("Generate says it is not connected until a generator is given, then fills the fields", async () => {
    const { container, store, tips } = await mountOpen();
    expect(buttonLabelled(container, "Generate").getAttribute("aria-disabled")).toBe("true");
    expect(tips()).toContain("Pull request generation is not connected yet");

    await settle(() => {
      store.getState().configurePullRequest(prGenerator().generate);
    });
    await press(buttonLabelled(container, "Generate"));
    expect(titleInput(container).value).toBe("feat(auth): add login");
    expect(bodyInput(container).value).toBe("## Summary\n- Adds login");
  });

  test("the generated text can be edited before creating", async () => {
    const { container, store, fake } = await mountOpen();
    await settle(() => {
      store.getState().configurePullRequest(prGenerator().generate);
    });
    await press(buttonLabelled(container, "Generate"));
    await typeInto(titleInput(container), "feat(auth): add the login form");
    await press(buttonLabelled(container, "Create PR"));
    expect(fake.ghCalls.at(-1)).toBe(`prCreate main draft=false ${JSON.stringify("feat(auth): add the login form")}`);
  });

  test("shows a spinner and locks the fields while Claude writes", async () => {
    const slow = deferred<GeneratedPullRequest>();
    const { container, store } = await mountOpen();
    await settle(() => {
      store.getState().configurePullRequest(() => slow.promise);
    });
    await press(buttonLabelled(container, "Generate"));
    expect(buttonLabelled(container, "Generate").getAttribute("aria-busy")).toBe("true");
    expect(titleInput(container).disabled).toBe(true);
    expect(bodyInput(container).disabled).toBe(true);

    await settle(() => {
      slow.resolve({ title: "feat: done", body: "Done." });
    });
    expect(titleInput(container).disabled).toBe(false);
    expect(titleInput(container).value).toBe("feat: done");
  });

  test("a failing generator is told next to the buttons and can be dismissed", async () => {
    const { container, store, text } = await mountOpen();
    await settle(() => {
      store.getState().configurePullRequest(() => Promise.reject(new Error("the bridge is not running")));
    });
    await press(buttonLabelled(container, "Generate"));
    expect(text()).toContain("Could not write the pull request.");
    expect(text()).toContain("the bridge is not running");

    await press(buttonLabelled(container, "Dismiss this message"));
    expect(text()).not.toContain("the bridge is not running");
  });

  test("a branch with nothing ahead of the base says so and cannot create", async () => {
    const { container, store, text, tips } = await mountOpen({ prContext: { ...DEFAULT_PR_CONTEXT, commits: [] } });
    await settle(() => {
      store.getState().configurePullRequest(prGenerator().generate);
    });
    await typeInto(titleInput(container), "feat: nothing");
    await press(buttonLabelled(container, "Generate"));
    expect(text()).toContain("no commits ahead of the base");
    expect(buttonLabelled(container, "Create PR").getAttribute("aria-disabled")).toBe("true");
    expect(tips()).toContain("feat/login has no commits ahead of main");
  });
});

describe("creating", () => {
  test("opens the pull request and shows it in place of the form", async () => {
    const { container, fake, text } = await mountOpen();
    await typeInto(titleInput(container), "feat: login");
    await typeInto(bodyInput(container), "Adds login.");
    await press(buttonLabelled(container, "Create PR"));

    expect(fake.ghCalls.at(-1)).toBe(`prCreate main draft=false ${JSON.stringify("feat: login")}`);
    expect(text()).toContain("#42 feat: login");
    expect(container.querySelector("input")).toBeNull();
    expect(buttonLabelled(container, "Open in browser")).toBeDefined();
  });

  test("the draft switch opens it as a draft", async () => {
    const { container, fake } = await mountOpen();
    await typeInto(titleInput(container), "feat: login");
    await press(buttonLabelled(container, "draft"));
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    await press(buttonLabelled(container, "Create PR"));

    expect(fake.ghCalls.at(-1)).toBe(`prCreate main draft=true ${JSON.stringify("feat: login")}`);
    expect(header(container).textContent).toContain("#42 draft");
  });

  test("shows a spinner on the button while it works", async () => {
    const slow = deferred<PrCreateResult>();
    const { container } = await mountOpen({ overrides: { prCreate: () => slow.promise } });
    await typeInto(titleInput(container), "feat: login");
    await press(buttonLabelled(container, "Create PR"));
    expect(buttonLabelled(container, "Create PR").getAttribute("aria-busy")).toBe("true");
  });

  test("a failure is told in plain words, the draft stays and the error can be dismissed", async () => {
    const { container, text } = await mountOpen({
      overrides: { prCreate: () => Promise.reject(new VcsCommandError("gh_unauthenticated", "not logged in")) },
    });
    await typeInto(titleInput(container), "feat: login");
    await press(buttonLabelled(container, "Create PR"));

    expect(text()).toContain("Could not create the pull request.");
    expect(text()).toContain("gh auth login");
    expect(titleInput(container).value).toBe("feat: login");

    await press(buttonLabelled(container, "Dismiss this message"));
    expect(text()).not.toContain("gh auth login");
  });
});

describe("tooltips", () => {
  test("every button and the base picker in the form explain themselves", async () => {
    const { container } = await mountOpen();
    const controls = [...container.querySelectorAll("button, select")];
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const control of controls) expect(control.getAttribute("aria-describedby")).not.toBeNull();
  });

  test("the header and the state badge have them too", async () => {
    const { container } = await mountOpen({ prInfo: { ...DEFAULT_PR_INFO, current: pullRequest() } });
    expect(header(container).getAttribute("aria-describedby")).not.toBeNull();
    expect(container.querySelector('[tabindex="0"]')?.getAttribute("aria-describedby")).not.toBeNull();
  });
});
