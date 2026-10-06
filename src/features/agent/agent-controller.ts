import {
  encodeLine,
  parseBridgeEvent,
  type AppMessage,
  type BridgeEvent,
  type PermissionDecision,
} from "@flare/protocol";

import { describeError } from "@/shared/lib/describe-error";

import type { BridgeTransport } from "./bridge-transport";
import type { SessionSettings } from "./session-settings";
import { createThread, type Thread } from "./thread-types";
import { addNotice, addUserMessage, applyBridgeEvent, markPermission, stopRunning } from "./transcript";

export interface AgentSnapshot {
  settings: SessionSettings;
  threads: Thread[];
  activeThreadId: string | null;
  liveThreadId: string | null;
}

export interface StoreAccess {
  get(): AgentSnapshot;
  set(update: (state: AgentSnapshot) => Partial<AgentSnapshot>): void;
}

export interface AgentDeps {
  transport: BridgeTransport;
  getWorkspaceRoot: () => string | null;
  publish: (event: BridgeEvent) => void;
  now: () => number;
  createId: () => string;
}

export class AgentController {
  readonly #deps: AgentDeps;
  readonly #store: StoreAccess;
  #connected = false;
  #generation = 0;
  #connecting: Promise<void> | null = null;

  constructor(deps: AgentDeps, store: StoreAccess) {
    this.#deps = deps;
    this.#store = store;
  }

  sendMessage(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const thread = this.#activeOrNewThread();
    if (this.#isBlockedByAnotherThread(thread.id)) {
      this.#updateThread(thread.id, (current) => addNotice(current, "Another thread is still running. Stop it first."));
      return;
    }
    this.#updateThread(thread.id, (current) => addUserMessage(current, trimmed));
    this.#track(thread.id, this.#deliver(thread, trimmed));
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const liveId = this.#store.get().liveThreadId;
    if (liveId === null) return;
    this.#updateThread(liveId, (thread) => markPermission(thread, requestId, decision));
    this.#track(liveId, this.#send({ type: "permission.respond", requestId, decision }));
  }

  interrupt(): void {
    const liveId = this.#store.get().liveThreadId;
    if (liveId === null) return;
    this.#track(liveId, this.#send({ type: "interrupt" }));
  }

  newThread(): void {
    this.#store.set(() => ({ activeThreadId: null }));
  }

  selectThread(id: string): void {
    const state = this.#store.get();
    const thread = state.threads.find((candidate) => candidate.id === id);
    if (!thread) return;
    this.#store.set(() => ({ activeThreadId: id }));
    if (thread.sessionId === null || state.liveThreadId === id || this.#isBlockedByAnotherThread(id)) return;
    this.#track(id, this.#connect().then(() => this.#startSession(thread)));
  }

  changeSettings(patch: Partial<SessionSettings>): void {
    const { settings, liveThreadId } = this.#store.get();
    const next = { ...settings, ...patch };
    this.#store.set(() => ({ settings: next }));
    if (liveThreadId === null) return;
    this.#track(liveThreadId, this.#sendSettingChanges(settings, next));
  }

  async #sendSettingChanges(previous: SessionSettings, next: SessionSettings): Promise<void> {
    if (next.model !== previous.model) await this.#send({ type: "session.setModel", model: next.model });
    if (next.effort !== previous.effort) await this.#send({ type: "session.setEffort", effort: next.effort });
    if (next.permissionMode !== previous.permissionMode) {
      await this.#send({ type: "session.setPermissionMode", permissionMode: next.permissionMode });
    }
  }

  #activeOrNewThread(): Thread {
    const { threads, activeThreadId } = this.#store.get();
    const active = threads.find((thread) => thread.id === activeThreadId);
    if (active) return active;
    const cwd = this.#deps.getWorkspaceRoot();
    if (cwd === null) throw new Error("Open a folder before starting a thread");
    const thread = createThread({ id: this.#deps.createId(), cwd, createdAt: this.#deps.now() });
    this.#store.set((state) => ({ threads: [thread, ...state.threads], activeThreadId: thread.id }));
    return thread;
  }

  #isBlockedByAnotherThread(threadId: string): boolean {
    const { threads, liveThreadId } = this.#store.get();
    if (liveThreadId === null || liveThreadId === threadId) return false;
    return threads.some((thread) => thread.id === liveThreadId && thread.status === "running");
  }

  async #deliver(thread: Thread, text: string): Promise<void> {
    try {
      await this.#connect();
      if (this.#store.get().liveThreadId !== thread.id) await this.#startSession(thread);
      await this.#send({ type: "user.message", text });
    } catch (error) {
      this.#updateThread(thread.id, stopRunning);
      throw error;
    }
  }

  async #startSession(thread: Thread): Promise<void> {
    const { settings } = this.#store.get();
    this.#store.set(() => ({ liveThreadId: thread.id }));
    try {
      await this.#send({
        type: "session.start",
        cwd: thread.cwd,
        model: settings.model,
        effort: settings.effort,
        permissionMode: settings.permissionMode,
        ...(thread.sessionId === null ? {} : { resume: thread.sessionId }),
      });
    } catch (error) {
      this.#store.set((state) => (state.liveThreadId === thread.id ? { liveThreadId: null } : {}));
      throw error;
    }
  }

  async #connect(): Promise<void> {
    if (this.#connected) return;
    this.#connecting ??= this.#startTransport().finally(() => {
      this.#connecting = null;
    });
    await this.#connecting;
  }

  async #startTransport(): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    await this.#deps.transport.start((line) => {
      this.#handleLine(generation, line);
    });
    this.#connected = true;
  }

  async #send(message: AppMessage): Promise<void> {
    try {
      await this.#deps.transport.send(encodeLine(message));
    } catch (error) {
      this.#connected = false;
      throw error;
    }
  }

  #handleLine(generation: number, line: string): void {
    if (generation !== this.#generation) return;
    let event: BridgeEvent;
    try {
      event = parseBridgeEvent(line);
    } catch (error) {
      this.#ingest({ type: "error", message: `Received an invalid message from the agent bridge: ${describeError(error)}` });
      return;
    }
    this.#ingest(event);
    this.#deps.publish(event);
  }

  #ingest(event: BridgeEvent): void {
    const { liveThreadId, activeThreadId } = this.#store.get();
    const targetId = liveThreadId ?? (event.type === "error" ? activeThreadId : null);
    if (targetId === null) return;
    this.#updateThread(targetId, (thread) => applyBridgeEvent(thread, event));
    if (event.type === "error" && event.fatal === true) {
      this.#connected = false;
      this.#store.set(() => ({ liveThreadId: null }));
    }
  }

  #track(threadId: string, work: Promise<void>): void {
    work.catch((error: unknown) => {
      this.#updateThread(threadId, (thread) => addNotice(thread, describeError(error)));
    });
  }

  #updateThread(id: string, update: (thread: Thread) => Thread): void {
    this.#store.set((state) => ({
      threads: state.threads.map((thread) => (thread.id === id ? update(thread) : thread)),
    }));
  }
}
