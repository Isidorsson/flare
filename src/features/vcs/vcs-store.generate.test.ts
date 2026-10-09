import { describe, expect, test } from "bun:test";

import { deferred, file, repoStatus } from "./fake-gateway";
import { VcsCommandError } from "./vcs-schemas";
import { OTHER_ROOT, ROOT, generator, opened } from "./store-test-support";

describe("generating a message", () => {
  test("is unavailable until a generator is configured", async () => {
    const { store, state, calls } = await opened();
    expect(state().canGenerate).toBe(false);
    await store.getState().generateMessage();
    expect(calls).toEqual(["status"]);
  });

  test("fills the subject from the diff and leaves the description alone when none is asked for", async () => {
    const { store, state, calls } = await opened();
    const { generate, inputs } = generator();
    store.getState().configure(generate);
    store.getState().setDescription("Typed by hand.");
    expect(state().canGenerate).toBe(true);

    const generating = store.getState().generateMessage();
    expect(state().generating).toBe(true);
    await generating;

    expect(calls).toContain("messageContext");
    expect(inputs).toEqual([
      {
        stat: " src/a.ts | 2 +-",
        patch: "diff --git a/src/a.ts b/src/a.ts\n-old\n+new",
        truncated: false,
        recentSubjects: ["feat(files): open diffs"],
        includeBody: false,
      },
    ]);
    expect(state().drafts[ROOT]).toMatchObject({ subject: "feat(files): add diffs", description: "Typed by hand." });
    expect(state().generating).toBe(false);
  });

  test("with the toggle on it also fills the description and asks the generator for one", async () => {
    const { store, state } = await opened();
    const { generate, inputs } = generator();
    store.getState().configure(generate);
    store.getState().setIncludeBody(true);
    await store.getState().generateMessage();

    expect(inputs[0]?.includeBody).toBe(true);
    expect(state().drafts[ROOT]).toMatchObject({ subject: "feat(files): add diffs", description: "Why.", includeBody: true });
  });

  test("the generated text can be edited afterwards", async () => {
    const { store, state } = await opened();
    store.getState().configure(generator().generate);
    await store.getState().generateMessage();
    store.getState().setSubject("feat(files): my own words");
    expect(state().drafts[ROOT]?.subject).toBe("feat(files): my own words");
  });

  test("a failing generator leaves the draft alone and shows the error", async () => {
    const { store, state } = await opened();
    store.getState().configure(() => Promise.reject(new Error("the bridge is not running")));
    store.getState().setSubject("feat: mine");
    await store.getState().generateMessage();

    expect(state().errors.generate).toBe("the bridge is not running");
    expect(state().drafts[ROOT]?.subject).toBe("feat: mine");
    expect(state().generating).toBe(false);
  });

  test("a failing context request is shown the same way", async () => {
    const { store, state } = await opened({ overrides: { messageContext: () => Promise.reject(new Error("diff too large")) } });
    store.getState().configure(generator().generate);
    await store.getState().generateMessage();
    expect(state().errors.generate).toBe("diff too large");
  });

  test("nothing to describe is explained in plain words", async () => {
    const { store, state } = await opened({
      overrides: { messageContext: () => Promise.reject(new VcsCommandError("nothing_to_describe", "no changes")) },
    });
    store.getState().configure(generator().generate);
    await store.getState().generateMessage();
    expect(state().errors.generate).toBe("There are no changes to write a message about.");
  });

  test("blocks a second generation and a commit while one runs", async () => {
    const slow = deferred<{ subject: string; body: string | null }>();
    const { store, state } = await opened({
      status: repoStatus({ files: [file("a.ts", "modified", null)] }),
    });
    let calls = 0;
    store.getState().configure(() => {
      calls += 1;
      return slow.promise;
    });
    store.getState().setSubject("fix: a");
    const first = store.getState().generateMessage();
    await store.getState().generateMessage();
    await store.getState().commit();

    expect(calls).toBe(1);
    expect(state().busy).toBeNull();
    slow.resolve({ subject: "fix: generated", body: null });
    await first;
    expect(state().drafts[ROOT]?.subject).toBe("fix: generated");
  });

  test("a message that arrives after the folder changed is not put in any draft", async () => {
    const slow = deferred<{ subject: string; body: string | null }>();
    const { store, state } = await opened();
    store.getState().configure(() => slow.promise);
    const generating = store.getState().generateMessage();
    await store.getState().setRoot(OTHER_ROOT);
    slow.resolve({ subject: "feat: late", body: null });
    await generating;

    expect(state().drafts[ROOT]).toBeUndefined();
    expect(state().drafts[OTHER_ROOT]).toBeUndefined();
    expect(state().generating).toBe(false);
  });
});
