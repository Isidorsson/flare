import type { FilesStore } from "../files-store";
import type { AgentFileChange } from "../files-types";
import { createActivityHost, type ActivityHost } from "./activity-host";
import type { EditAction } from "./action-queue";
import { diffLines } from "./line-diff";
import type { LiveStore } from "./live-store";
import type { ReadRequest, TypingEdit } from "./live-types";
import { ActivityPlayer, type Scheduler } from "./player";
import { turnReplay } from "./turn-summary";

export interface AgentFileRead extends ReadRequest {
  path: string;
}

export interface AgentFileEditing extends TypingEdit {
  toolUseId: string;
  path: string;
}

export interface ActivityDeps {
  files: FilesStore;
  live: LiveStore;
  scheduler: Scheduler;
  now: () => number;
}

interface TypingSession {
  toolUseId: string;
  path: string;
  playId: number;
  latest: AgentFileEditing;
  // The file is open in the editor, so the typed text can be shown.
  ready: boolean;
  created: boolean;
}

/**
 * What the app does when the agent reads, types and changes files: it keeps
 * the heat map and the per-turn changes up to date, and shows the activity in
 * the editor through the player when the rules for following the agent allow.
 */
export class AgentActivity {
  readonly #files: FilesStore;
  readonly #live: LiveStore;
  readonly #now: () => number;
  readonly #host: ActivityHost;
  readonly #player: ActivityPlayer;
  readonly #stopWatching: () => void;
  #typing: TypingSession | null = null;

  constructor({ files, live, scheduler, now }: ActivityDeps) {
    this.#files = files;
    this.#live = live;
    this.#now = now;
    this.#host = createActivityHost(files, live, now);
    this.#player = new ActivityPlayer(this.#host, scheduler);
    this.#stopWatching = files.subscribe((state, previous) => {
      if (state.generation !== previous.generation) this.#reset();
    });
  }

  noteRead(read: AgentFileRead): void {
    const path = this.#host.resolve(read.path);
    if (path === null) return;
    this.#live.getState().touch(path, { kind: "read", lines: 0, at: this.#now() });
    this.#player.enqueue({ kind: "read", path, request: { range: read.range, pattern: read.pattern, matchLines: read.matchLines } });
  }

  applyChange(change: AgentFileChange): void {
    if (this.#typing !== null && this.#typing.toolUseId !== change.toolUseId) this.#endTyping();
    const entry = this.#files.getState().applyAgentFileChange(change);
    const lines = diffLines(entry.before ?? "", entry.after).reduce((sum, hunk) => sum + hunk.oldCount + hunk.newCount, 0);
    this.#live.getState().touch(entry.path, { kind: "edit", lines, at: this.#now() });
    const typed = this.#typing?.toolUseId === change.toolUseId && this.#typing.ready;
    const action: EditAction = { kind: "edit", path: entry.path, before: entry.before, after: entry.after, settled: typed, forced: false };
    this.#player.interruptEditOf(entry.path);
    this.#player.enqueue(action, { front: typed });
    if (this.#typing?.toolUseId === change.toolUseId) this.#finishTyping(this.#typing);
  }

  noteEditing(editing: AgentFileEditing): void {
    const session = this.#typing;
    if (session?.toolUseId === editing.toolUseId) {
      session.latest = editing;
      this.#publishTyping(session);
      return;
    }
    this.#startTyping(editing);
  }

  /** The tool ended; if it never produced a change, whatever was typed on screen goes away. */
  endEditing(toolUseId: string): void {
    if (this.#typing?.toolUseId === toolUseId) this.#endTyping();
  }

  startTurn(turnId: string): void {
    this.#endTyping();
    this.#files.getState().startTurn(turnId);
  }

  endTurn(): void {
    this.#endTyping();
  }

  /** Opens the file and plays this turn's change to it again. */
  replay(rawPath: string): void {
    const path = this.#host.resolve(rawPath);
    if (path === null) return;
    const { changes, turnId } = this.#files.getState();
    const net = turnReplay(changes, turnId, path);
    if (net === null) return;
    this.#player.enqueue({ kind: "edit", path, before: net.before, after: net.after, settled: false, forced: true }, { front: true });
  }

  dispose(): void {
    this.#stopWatching();
    this.#reset();
  }

  #startTyping(editing: AgentFileEditing): void {
    this.#endTyping();
    const path = this.#host.resolve(editing.path);
    if (path === null) return;
    const session: TypingSession = {
      toolUseId: editing.toolUseId,
      path,
      playId: this.#player.nextPlayId(),
      latest: editing,
      ready: false,
      created: false,
    };
    this.#typing = session;
    this.#player.hold(editing.toolUseId);
    this.#openForTyping(session).catch((error: unknown) => {
      console.error(`flare: could not show the agent typing into ${path}`, error);
      this.#endTyping();
    });
  }

  async #openForTyping(session: TypingSession): Promise<void> {
    const target = await this.#host.prepareTyping(session.path, session.latest.kind);
    if (this.#typing !== session) {
      if (target.created) this.#host.closeIfStillBlank(session.path);
      return;
    }
    if (target.file === null) {
      this.#endTyping();
      return;
    }
    session.ready = true;
    session.created = target.created;
    this.#publishTyping(session);
  }

  #publishTyping(session: TypingSession): void {
    if (!session.ready) return;
    const { kind, oldString, text } = session.latest;
    this.#live.getState().setPlay({ kind: "typing", id: session.playId, path: session.path, edit: { kind, oldString, text }, created: session.created });
  }

  // The change arrived: the editor keeps the typed text until the settling play takes over.
  #finishTyping(session: TypingSession): void {
    this.#typing = null;
    this.#player.release(session.toolUseId);
  }

  #endTyping(): void {
    const session = this.#typing;
    if (session === null) return;
    this.#typing = null;
    if (session.ready) this.#live.getState().clearPlay(session.playId);
    if (session.created) this.#host.closeIfStillBlank(session.path);
    this.#player.release(session.toolUseId);
  }

  #reset(): void {
    this.#typing = null;
    this.#player.reset();
    this.#live.getState().reset();
  }
}
