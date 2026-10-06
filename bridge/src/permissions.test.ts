import { describe, expect, test } from "bun:test";

import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { BridgeEvent } from "@flare/protocol";

import { PermissionBroker, sessionPermissionUpdates } from "./permissions";

function setup() {
  const events: BridgeEvent[] = [];
  const broker = new PermissionBroker((event) => events.push(event));
  const controller = new AbortController();
  function ask(toolName: string, input: Record<string, unknown>, suggestions?: PermissionUpdate[], requestId = "r1") {
    return broker.canUseTool(toolName, input, {
      signal: controller.signal,
      toolUseID: "tool-1",
      requestId,
      ...(suggestions === undefined ? {} : { suggestions }),
    });
  }
  return { broker, controller, events, ask };
}

describe("PermissionBroker", () => {
  test("emits a permission.request and waits for the decision", async () => {
    const { broker, events, ask } = setup();
    const result = ask("Bash", { command: "ls" });

    expect(events).toEqual([{ type: "permission.request", requestId: "r1", toolName: "Bash", input: { command: "ls" } }]);
    expect(broker.pendingCount).toBe(1);

    expect(broker.respond("r1", "allow")).toBe(true);
    expect(await result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
    expect(broker.pendingCount).toBe(0);
  });

  test("denies with a message the model can read", async () => {
    const { broker, ask } = setup();
    const result = ask("Bash", { command: "rm -rf /" });
    broker.respond("r1", "deny");
    expect(await result).toEqual({ behavior: "deny", message: "The user denied this action." });
  });

  test("allowSession attaches the suggestions scoped to the session", async () => {
    const { broker, ask } = setup();
    const suggestion: PermissionUpdate = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
      behavior: "allow",
      destination: "localSettings",
    };
    const result = ask("Bash", { command: "npm test" }, [suggestion]);
    broker.respond("r1", "allowSession");

    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: { command: "npm test" },
      updatedPermissions: [{ ...suggestion, destination: "session" }],
    });
  });

  test("allowSession falls back to a tool wide session rule without suggestions", async () => {
    const { broker, ask } = setup();
    const result = ask("Edit", { file_path: "a.ts" });
    broker.respond("r1", "allowSession");

    expect(await result).toMatchObject({
      behavior: "allow",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Edit" }], behavior: "allow", destination: "session" }],
    });
  });

  test("keeps concurrent requests apart", async () => {
    const { broker, ask } = setup();
    const first = ask("Bash", { command: "a" }, undefined, "r1");
    const second = ask("Bash", { command: "b" }, undefined, "r2");

    broker.respond("r2", "deny");
    broker.respond("r1", "allow");

    expect((await first).behavior).toBe("allow");
    expect((await second).behavior).toBe("deny");
  });

  test("respond returns false for unknown or already answered requests", async () => {
    const { broker, ask } = setup();
    const result = ask("Bash", {});
    broker.respond("r1", "allow");
    await result;

    expect(broker.respond("r1", "allow")).toBe(false);
    expect(broker.respond("nope", "deny")).toBe(false);
  });

  test("denyAll settles every pending request", async () => {
    const { broker, ask } = setup();
    const first = ask("Bash", {}, undefined, "r1");
    const second = ask("Edit", {}, undefined, "r2");

    broker.denyAll("The turn was interrupted.");

    expect(await first).toEqual({ behavior: "deny", message: "The turn was interrupted." });
    expect(await second).toEqual({ behavior: "deny", message: "The turn was interrupted." });
    expect(broker.pendingCount).toBe(0);
  });

  test("denies and forgets a request the CLI cancelled", async () => {
    const { broker, controller, ask } = setup();
    const result = ask("Bash", {});

    controller.abort();

    expect(await result).toEqual({ behavior: "deny", message: "The request was cancelled." });
    expect(broker.pendingCount).toBe(0);
  });
});

describe("sessionPermissionUpdates", () => {
  test("rewrites every suggestion to the session destination", () => {
    const updates = sessionPermissionUpdates("Edit", [
      { type: "setMode", mode: "acceptEdits", destination: "userSettings" },
      { type: "addDirectories", directories: ["/tmp"], destination: "projectSettings" },
    ]);
    expect(updates.map((update) => update.destination)).toEqual(["session", "session"]);
  });
});
