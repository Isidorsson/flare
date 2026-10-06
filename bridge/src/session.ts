import type {
  HookCallback,
  Options,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AppMessageOf, BridgeEvent, Effort, PermissionDecision } from "@flare/protocol";

import type { ReadText } from "./file-capture";
import { MessageNormalizer } from "./normalize";
import { PermissionBroker } from "./permissions";
import { AsyncQueue } from "./queue";

export interface AgentQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  applyFlagSettings(settings: { effortLevel: Effort }): Promise<void>;
  initializationResult(): Promise<{ available_output_styles: string[] }>;
  close(): void;
}

export type QueryFactory = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AgentQuery;

export interface SessionDeps {
  createQuery: QueryFactory;
  emit: (event: BridgeEvent) => void;
  readText: ReadText;
  resolveClaudeExecutable: () => string;
  createSessionId: () => string;
  log: (line: string) => void;
}

interface ActiveSession {
  query: AgentQuery;
  input: AsyncQueue<SDKUserMessage>;
  normalizer: MessageNormalizer;
  broker: PermissionBroker;
  pump: Promise<void>;
}

export class AgentSession {
  readonly #deps: SessionDeps;
  #active: ActiveSession | null = null;

  constructor(deps: SessionDeps) {
    this.#deps = deps;
  }

  start(message: AppMessageOf<"session.start">): void {
    this.close();
    const sessionId = message.resume ?? this.#deps.createSessionId();
    const normalizer = new MessageNormalizer({ sessionId, cwd: message.cwd, readText: this.#deps.readText });
    const broker = new PermissionBroker(this.#deps.emit);
    const input = new AsyncQueue<SDKUserMessage>();
    const query = this.#deps.createQuery({
      prompt: input,
      options: buildOptions({
        message,
        sessionId,
        executable: this.#deps.resolveClaudeExecutable(),
        broker,
        normalizer,
        log: this.#deps.log,
      }),
    });
    const active: ActiveSession = { query, input, normalizer, broker, pump: Promise.resolve() };
    this.#active = active;
    active.pump = this.#pump(active);
    this.#deps.emit({ type: "session.ready", sessionId });
    void this.#announceOutputStyles(query);
  }

  async #announceOutputStyles(query: AgentQuery): Promise<void> {
    try {
      const { available_output_styles: available } = await query.initializationResult();
      if (this.#active?.query === query) this.#deps.emit({ type: "session.outputStyles", available });
    } catch (error) {
      this.#deps.log(`could not list output styles: ${String(error)}`);
    }
  }

  sendUserMessage(text: string): void {
    this.#require().input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
  }

  respondToPermission(requestId: string, decision: PermissionDecision): void {
    if (!this.#require().broker.respond(requestId, decision)) {
      throw new Error(`No pending permission request ${requestId}`);
    }
  }

  async interrupt(): Promise<void> {
    const active = this.#require();
    active.broker.denyAll("The turn was interrupted.");
    await active.query.interrupt();
  }

  async setModel(model: string): Promise<void> {
    await this.#require().query.setModel(model);
  }

  async setEffort(effort: Effort): Promise<void> {
    await this.#require().query.applyFlagSettings({ effortLevel: effort });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.#require().query.setPermissionMode(mode);
  }

  close(): void {
    const active = this.#active;
    this.#active = null;
    if (!active) return;
    active.broker.denyAll("The session was closed.");
    active.input.close();
    active.query.close();
  }

  settled(): Promise<void> {
    return this.#active?.pump ?? Promise.resolve();
  }

  #require(): ActiveSession {
    if (!this.#active) throw new Error("No active session; send session.start first");
    return this.#active;
  }

  async #pump(active: ActiveSession): Promise<void> {
    try {
      for await (const message of active.query) {
        const events = await active.normalizer.normalize(message);
        if (this.#active !== active) return;
        for (const event of events) this.#deps.emit(event);
      }
      this.#end(active, "Claude Code ended the session.");
    } catch (error) {
      this.#end(active, `Claude Code stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #end(active: ActiveSession, reason: string): void {
    if (this.#active !== active) return;
    this.#active = null;
    active.broker.denyAll(reason);
    active.normalizer.reset();
    this.#deps.emit({ type: "error", message: reason, fatal: true });
  }
}

interface OptionsParams {
  message: AppMessageOf<"session.start">;
  sessionId: string;
  executable: string;
  broker: PermissionBroker;
  normalizer: MessageNormalizer;
  log: (line: string) => void;
}

function buildOptions({ message, sessionId, executable, broker, normalizer, log }: OptionsParams): Options {
  return {
    cwd: message.cwd,
    model: message.model,
    effort: message.effort,
    permissionMode: message.permissionMode,
    includePartialMessages: true,
    pathToClaudeCodeExecutable: executable,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settings: { outputStyle: message.outputStyle },
    canUseTool: broker.canUseTool,
    hooks: { PreToolUse: [{ hooks: [captureBeforeToolUse(normalizer)] }] },
    stderr: log,
    ...(message.resume === undefined ? { sessionId } : { resume: message.resume }),
  };
}

// Hooks run before the tool executes, so this is the last moment the file still holds its old content.
function captureBeforeToolUse(normalizer: MessageNormalizer): HookCallback {
  return async (input) => {
    if (input.hook_event_name === "PreToolUse") {
      await normalizer.beginTool(input.tool_use_id, input.tool_name, input.tool_input);
    }
    return { continue: true };
  };
}
