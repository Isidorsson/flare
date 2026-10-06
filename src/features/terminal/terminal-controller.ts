import { toError } from "./errors";
import { hasTab, type TerminalStore } from "./terminal-store";

export interface TerminalSession {
  mount: (container: HTMLElement) => () => void;
  focus: () => void;
  /** Tears down the view only; the shell keeps running until it is killed. */
  detach: () => void;
  /** Detaches the view and kills the shell. */
  dispose: () => Promise<void>;
}

export interface SessionOptions {
  id: string;
  cwd: string | null;
}

export interface SessionEvents {
  onExit: (code: number | null) => void;
}

export type SessionFactory = (options: SessionOptions, events: SessionEvents) => Promise<TerminalSession>;

export interface ControllerDeps {
  store: TerminalStore;
  createSession: SessionFactory;
  /** Kills every shell the backend holds and resolves to how many it closed. */
  killAll: () => Promise<number>;
  getCwd: () => string | null;
  newId: () => string;
}

export interface TerminalController {
  openTab: () => string;
  closeTab: (id: string) => void;
  closeAll: () => void;
  getSession: (id: string) => TerminalSession | undefined;
}

async function reportFailure(action: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`flare: failed to ${action}`, error);
  }
}

/**
 * Owns the live sessions behind the tab store. Tabs are created and closed
 * only through here so a shell is never left running without a tab.
 */
export function createTerminalController(deps: ControllerDeps): TerminalController {
  const { store, createSession, killAll, getCwd, newId } = deps;
  const sessions = new Map<string, TerminalSession>();

  const disposeQuietly = (session: TerminalSession) =>
    reportFailure("dispose terminal session", () => session.dispose());

  const start = async (id: string): Promise<void> => {
    // A shell can exit before its session is registered; the tab must never
    // report "exited" without a session to show, so that exit is applied last.
    const earlyExits: (number | null)[] = [];
    let live = false;
    const events: SessionEvents = {
      onExit: (code) => {
        if (live) store.getState().setStatus(id, { kind: "exited", code });
        else earlyExits.push(code);
      },
    };
    try {
      const session = await createSession({ id, cwd: getCwd() }, events);
      if (!hasTab(store.getState().tabs, id)) {
        await disposeQuietly(session);
        return;
      }
      sessions.set(id, session);
      live = true;
      const exitCode = earlyExits[0];
      store
        .getState()
        .setStatus(id, exitCode === undefined ? { kind: "running" } : { kind: "exited", code: exitCode });
    } catch (error) {
      console.error("flare: failed to start terminal", error);
      store.getState().setStatus(id, { kind: "failed", message: toError(error).message });
    }
  };

  return {
    openTab: () => {
      const id = newId();
      store.getState().addTab(id);
      void start(id);
      return id;
    },

    closeTab: (id) => {
      store.getState().closeTab(id);
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      void disposeQuietly(session);
    },

    // A shell still starting has no session yet; it is disposed when it arrives and finds its tab gone.
    closeAll: () => {
      const live = [...sessions.values()];
      sessions.clear();
      store.getState().closeAllTabs();
      for (const session of live) session.detach();
      void reportFailure("close all terminals", killAll);
    },

    getSession: (id) => sessions.get(id),
  };
}
