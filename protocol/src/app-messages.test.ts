import { describe, expect, test } from "bun:test";

import { appMessageSchema } from "./app-messages";

const validMessages: Record<string, object> = {
  "session.start": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
  },
  "session.start with resume": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "opus",
    effort: "max",
    permissionMode: "acceptEdits",
    resume: "5a7c1e1e-0000-4000-8000-000000000000",
  },
  "user.message": { type: "user.message", text: "hello" },
  "permission.respond allow": { type: "permission.respond", requestId: "r1", decision: "allow" },
  "permission.respond allowSession": { type: "permission.respond", requestId: "r1", decision: "allowSession" },
  "permission.respond deny": { type: "permission.respond", requestId: "r1", decision: "deny" },
  interrupt: { type: "interrupt" },
  "session.setModel": { type: "session.setModel", model: "haiku" },
  "session.setEffort": { type: "session.setEffort", effort: "xhigh" },
  "session.setPermissionMode": { type: "session.setPermissionMode", permissionMode: "plan" },
};

const invalidMessages: Record<string, unknown> = {
  "unknown type": { type: "session.stop" },
  "missing type": { text: "hello" },
  "not an object": "interrupt",
  "session.start without cwd": { type: "session.start", model: "sonnet", effort: "high", permissionMode: "default" },
  "session.start with empty model": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "",
    effort: "high",
    permissionMode: "default",
  },
  "session.start with unknown effort": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "extreme",
    permissionMode: "default",
  },
  "session.start with unsupported permission mode": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "bypassPermissions",
  },
  "session.start with empty resume": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    resume: "",
  },
  "user.message with empty text": { type: "user.message", text: "" },
  "user.message with non-string text": { type: "user.message", text: 4 },
  "permission.respond with unknown decision": { type: "permission.respond", requestId: "r1", decision: "maybe" },
  "permission.respond without requestId": { type: "permission.respond", decision: "allow" },
  "session.setModel without model": { type: "session.setModel" },
  "session.setEffort with unknown effort": { type: "session.setEffort", effort: "ultra" },
  "session.setPermissionMode with unknown mode": { type: "session.setPermissionMode", permissionMode: "yolo" },
};

describe("appMessageSchema", () => {
  test.each(Object.entries(validMessages))("accepts %s", (_name, message) => {
    expect(appMessageSchema.parse(message)).toMatchObject(message);
  });

  test.each(Object.entries(invalidMessages))("rejects %s", (_name, message) => {
    expect(appMessageSchema.safeParse(message).success).toBe(false);
  });

  test("covers every message type in the plan", () => {
    const types = new Set(Object.values(validMessages).map((message) => appMessageSchema.parse(message).type));
    expect(types).toEqual(
      new Set([
        "session.start",
        "user.message",
        "permission.respond",
        "interrupt",
        "session.setModel",
        "session.setEffort",
        "session.setPermissionMode",
      ]),
    );
  });

  test("drops unknown fields so additive changes stay compatible", () => {
    const parsed = appMessageSchema.parse({ type: "interrupt", extra: true });
    expect(parsed).toEqual({ type: "interrupt" });
  });
});
