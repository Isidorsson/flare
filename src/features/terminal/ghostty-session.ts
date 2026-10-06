import type { Terminal } from "ghostty-web";

import type { SessionEvents, SessionFactory, TerminalSession } from "./terminal-controller";
import { toError } from "./errors";
import { loadGhostty } from "./ghostty-loader";
import { killPty, resizePty, spawnPty, writePty } from "./pty-api";
import { describeExit, type PtyMessage } from "./pty-protocol";
import { createSerialRunner } from "./serial-runner";
import { installKeyHandling, mountHost, openTerminalHost, writeNotice } from "./terminal-host";

interface SessionState {
  closed: boolean;
  exited: boolean;
}

function createMessageHandler(term: Terminal, state: SessionState, events: SessionEvents) {
  return (message: PtyMessage) => {
    if (state.closed) return;
    if (message.kind === "output") {
      term.write(message.bytes);
      return;
    }
    state.exited = true;
    writeNotice(term, "info", describeExit(message.code));
    events.onExit(message.code);
  };
}

/**
 * Wired before the spawn call returns: ConPTY blocks its first output until the
 * terminal answers a cursor-position query, and that answer is written back
 * through onData, so input must queue behind the spawn instead of being lost.
 */
function wireTerminalInput(term: Terminal, id: string, state: SessionState, spawned: Promise<void>): void {
  const run = createSerialRunner((error) => {
    if (state.closed) return;
    console.error("flare: terminal I/O failed", error);
    writeNotice(term, "error", `terminal error: ${toError(error).message}`);
  });
  const afterSpawn = (task: () => Promise<void>) => {
    run(async () => {
      await spawned;
      await task();
    });
  };
  term.onData((data) => {
    if (!state.exited) afterSpawn(() => writePty(id, data));
  });
  term.onResize(({ cols, rows }) => {
    if (!state.exited) afterSpawn(() => resizePty(id, cols, rows));
  });
  installKeyHandling(term);
}

export const createGhosttySession: SessionFactory = async (options, events): Promise<TerminalSession> => {
  const host = openTerminalHost(await loadGhostty());
  const { term } = host;
  const state: SessionState = { closed: false, exited: false };

  const spawned = spawnPty({ ...options, cols: term.cols, rows: term.rows }, createMessageHandler(term, state, events));
  wireTerminalInput(term, options.id, state, spawned);
  try {
    await spawned;
  } catch (error) {
    state.closed = true;
    term.dispose();
    throw error;
  }

  return {
    mount: (container) => mountHost(host, container),
    focus: () => {
      term.focus();
    },
    dispose: async () => {
      state.closed = true;
      host.element.remove();
      term.dispose();
      await killPty(options.id);
    },
  };
};
