import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  createTerminalController,
  type SessionEvents,
  type SessionFactory,
  type SessionOptions,
  type TerminalSession,
} from "./terminal-controller";
import { createTerminalStore } from "./terminal-store";

interface FakeSession extends TerminalSession {
  disposed: number;
  detached: number;
}

function fakeSession(): FakeSession {
  const session: FakeSession = {
    disposed: 0,
    detached: 0,
    mount: () => () => undefined,
    focus: () => undefined,
    detach: () => {
      session.detached += 1;
    },
    dispose: () => {
      session.disposed += 1;
      return Promise.resolve();
    },
  };
  return session;
}

interface Launch {
  options: SessionOptions;
  events: SessionEvents;
  resolve: (session: TerminalSession) => void;
  reject: (error: Error) => void;
}

function setup(cwd: string | null = "C:/code/app") {
  const store = createTerminalStore();
  const launches: Launch[] = [];
  const createSession: SessionFactory = (options, events) =>
    new Promise<TerminalSession>((resolve, reject) => {
      launches.push({ options, events, resolve, reject });
    });
  const killAllCalls: { resolve: (closed: number) => void; reject: (error: Error) => void }[] = [];
  const killAll = () =>
    new Promise<number>((resolve, reject) => {
      killAllCalls.push({ resolve, reject });
    });
  let counter = 0;
  const controller = createTerminalController({
    store,
    createSession,
    killAll,
    getCwd: () => cwd,
    newId: () => `t${++counter}`,
  });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return { store, controller, launches, killAllCalls, settle };
}

let consoleError: ReturnType<typeof spyOn<Console, "error">>;

beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("terminal controller", () => {
  test("opens a starting tab and starts a session in the workspace root", () => {
    const { store, controller, launches } = setup("C:/code/app");

    const id = controller.openTab();

    expect(id).toBe("t1");
    expect(store.getState().tabs[0]?.status).toEqual({ kind: "starting" });
    expect(launches[0]?.options).toEqual({ id: "t1", cwd: "C:/code/app" });
  });

  test("passes a null cwd through when no workspace is open", () => {
    const { controller, launches } = setup(null);
    controller.openTab();

    expect(launches[0]?.options.cwd).toBeNull();
  });

  test("registers the session and marks the tab running once it is ready", async () => {
    const { store, controller, launches, settle } = setup();
    const id = controller.openTab();
    const session = fakeSession();

    launches[0]?.resolve(session);
    await settle();

    expect(controller.getSession(id)).toBe(session);
    expect(store.getState().tabs[0]?.status).toEqual({ kind: "running" });
  });

  test("marks the tab failed when the session cannot start", async () => {
    const { store, controller, launches, settle } = setup();
    const id = controller.openTab();

    launches[0]?.reject(new Error("no shell"));
    await settle();

    expect(controller.getSession(id)).toBeUndefined();
    expect(store.getState().tabs[0]?.status).toEqual({ kind: "failed", message: "no shell" });
    expect(consoleError).toHaveBeenCalled();
  });

  test("records the exit code of a running shell", async () => {
    const { store, launches, controller, settle } = setup();
    controller.openTab();
    launches[0]?.resolve(fakeSession());
    await settle();

    launches[0]?.events.onExit(130);

    expect(store.getState().tabs[0]?.status).toEqual({ kind: "exited", code: 130 });
  });

  test("applies an exit that arrived before the session was registered", async () => {
    const { store, launches, controller, settle } = setup();
    const id = controller.openTab();

    launches[0]?.events.onExit(1);
    expect(store.getState().tabs[0]?.status).toEqual({ kind: "starting" });
    launches[0]?.resolve(fakeSession());
    await settle();

    expect(store.getState().tabs[0]?.status).toEqual({ kind: "exited", code: 1 });
    expect(controller.getSession(id)).toBeDefined();
  });

  test("closing a tab removes it and disposes its session once", async () => {
    const { store, controller, launches, settle } = setup();
    const id = controller.openTab();
    const session = fakeSession();
    launches[0]?.resolve(session);
    await settle();

    controller.closeTab(id);
    controller.closeTab(id);

    expect(store.getState().tabs).toEqual([]);
    expect(controller.getSession(id)).toBeUndefined();
    expect(session.disposed).toBe(1);
  });

  test("disposes a session that finishes starting after its tab was closed", async () => {
    const { store, controller, launches, settle } = setup();
    const id = controller.openTab();
    controller.closeTab(id);
    const session = fakeSession();

    launches[0]?.resolve(session);
    await settle();

    expect(session.disposed).toBe(1);
    expect(controller.getSession(id)).toBeUndefined();
    expect(store.getState().tabs).toEqual([]);
  });

  test("reports a failing dispose without throwing", async () => {
    const { controller, launches, settle } = setup();
    const id = controller.openTab();
    const session: TerminalSession = {
      ...fakeSession(),
      dispose: () => Promise.reject(new Error("kill failed")),
    };
    launches[0]?.resolve(session);
    await settle();

    controller.closeTab(id);
    await settle();

    expect(consoleError).toHaveBeenCalled();
  });

  test("keeps sessions of different tabs apart", async () => {
    const { controller, launches, settle } = setup();
    const first = controller.openTab();
    const second = controller.openTab();
    const sessionA = fakeSession();
    const sessionB = fakeSession();
    launches[0]?.resolve(sessionA);
    launches[1]?.resolve(sessionB);
    await settle();

    controller.closeTab(first);

    expect(sessionA.disposed).toBe(1);
    expect(sessionB.disposed).toBe(0);
    expect(controller.getSession(second)).toBe(sessionB);
  });

  describe("closing every terminal", () => {
    test("clears the tabs, detaches each live session and kills the backend once", async () => {
      const { store, controller, launches, killAllCalls, settle } = setup();
      const first = controller.openTab();
      const second = controller.openTab();
      const sessionA = fakeSession();
      const sessionB = fakeSession();
      launches[0]?.resolve(sessionA);
      launches[1]?.resolve(sessionB);
      await settle();

      controller.closeAll();

      expect(store.getState().tabs).toEqual([]);
      expect(store.getState().activeId).toBeNull();
      expect(controller.getSession(first)).toBeUndefined();
      expect(controller.getSession(second)).toBeUndefined();
      expect([sessionA.detached, sessionB.detached]).toEqual([1, 1]);
      expect([sessionA.disposed, sessionB.disposed]).toEqual([0, 0]);
      expect(killAllCalls).toHaveLength(1);
    });

    test("still asks the backend when no tab is open, in case a shell leaked", () => {
      const { controller, killAllCalls } = setup();

      controller.closeAll();

      expect(killAllCalls).toHaveLength(1);
    });

    test("disposes a session that was still starting once it arrives", async () => {
      const { store, controller, launches, settle } = setup();
      const id = controller.openTab();
      controller.closeAll();
      const session = fakeSession();

      launches[0]?.resolve(session);
      await settle();

      expect(session.disposed).toBe(1);
      expect(controller.getSession(id)).toBeUndefined();
      expect(store.getState().tabs).toEqual([]);
    });

    test("leaves tabs opened afterwards alone", async () => {
      const { store, controller, launches, settle } = setup();
      controller.openTab();
      controller.closeAll();
      const later = controller.openTab();
      const session = fakeSession();
      launches[1]?.resolve(session);
      await settle();

      expect(controller.getSession(later)).toBe(session);
      expect(store.getState().tabs.map((tab) => tab.id)).toEqual([later]);
    });

    test("reports a failing backend close without throwing", async () => {
      const { controller, killAllCalls, settle } = setup();

      controller.closeAll();
      killAllCalls[0]?.reject(new Error("could not stop a shell"));
      await settle();

      expect(consoleError).toHaveBeenCalled();
    });
  });
});
