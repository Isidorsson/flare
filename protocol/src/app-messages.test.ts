import { describe, expect, test } from "bun:test";

import { appMessageSchema, type AppMessageOf } from "./app-messages";
import { BUILT_IN_OUTPUT_STYLES, MAX_COMMIT_RECENT_SUBJECTS, PERMISSION_MODES } from "./constants";

const commitGenerate: AppMessageOf<"commit.generate"> = {
  type: "commit.generate",
  requestId: "c1",
  stat: "",
  patch: "diff --git a/a b/a\n",
  truncated: false,
  recentSubjects: [],
  includeBody: false,
};

const validMessages: Record<string, object> = {
  "session.start": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    outputStyle: "Concise",
  },
  "session.start with resume": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "opus",
    effort: "max",
    permissionMode: "acceptEdits",
    outputStyle: "Concise",
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
  "commit.generate": {
    type: "commit.generate",
    requestId: "c1",
    stat: " src/a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    patch: "diff --git a/src/a.ts b/src/a.ts\n-a\n+b\n",
    truncated: false,
    recentSubjects: ["feat(chat): stream replies", "fix(graph): keep labels"],
    includeBody: true,
  },
  "commit.generate with nothing to style from": {
    type: "commit.generate",
    requestId: "c2",
    stat: "",
    patch: "",
    truncated: true,
    recentSubjects: [],
    includeBody: false,
  },
};

const invalidMessages: Record<string, unknown> = {
  "unknown type": { type: "session.stop" },
  "missing type": { text: "hello" },
  "not an object": "interrupt",
  "session.start without cwd": {
    type: "session.start",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    outputStyle: "Concise",
  },
  "session.start with empty model": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "",
    effort: "high",
    permissionMode: "default",
    outputStyle: "Concise",
  },
  "session.start with unknown effort": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "extreme",
    permissionMode: "default",
    outputStyle: "Concise",
  },
  "session.start with unsupported permission mode": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "bypassPermissions",
    outputStyle: "Concise",
  },
  "session.start without outputStyle": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
  },
  "session.start with empty outputStyle": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    outputStyle: "",
  },
  "session.start with empty resume": {
    type: "session.start",
    cwd: "C:/work/app",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    outputStyle: "Concise",
    resume: "",
  },
  "user.message with empty text": { type: "user.message", text: "" },
  "user.message with non-string text": { type: "user.message", text: 4 },
  "permission.respond with unknown decision": { type: "permission.respond", requestId: "r1", decision: "maybe" },
  "permission.respond without requestId": { type: "permission.respond", decision: "allow" },
  "session.setModel without model": { type: "session.setModel" },
  "session.setEffort with unknown effort": { type: "session.setEffort", effort: "ultra" },
  "session.setPermissionMode with unknown mode": { type: "session.setPermissionMode", permissionMode: "yolo" },
  "commit.generate without requestId": { ...commitGenerate, requestId: undefined },
  "commit.generate with empty requestId": { ...commitGenerate, requestId: "" },
  "commit.generate without patch": { ...commitGenerate, patch: undefined },
  "commit.generate with non-boolean truncated": { ...commitGenerate, truncated: "yes" },
  "commit.generate without includeBody": { ...commitGenerate, includeBody: undefined },
  "commit.generate with non-array recentSubjects": { ...commitGenerate, recentSubjects: "feat: x" },
  "commit.generate with a non-string subject": { ...commitGenerate, recentSubjects: [4] },
  "commit.generate with too many recentSubjects": {
    ...commitGenerate,
    recentSubjects: Array.from({ length: MAX_COMMIT_RECENT_SUBJECTS + 1 }, (_, index) => `fix: ${String(index)}`),
  },
};

describe("appMessageSchema", () => {
  test.each(Object.entries(validMessages))("accepts %s", (_name, message) => {
    expect(appMessageSchema.parse(message)).toMatchObject(message);
  });

  test.each(Object.entries(invalidMessages))("rejects %s", (_name, message) => {
    expect(appMessageSchema.safeParse(message).success).toBe(false);
  });

  test.each([...PERMISSION_MODES])("accepts permission mode %s when starting and switching", (permissionMode) => {
    const start = {
      type: "session.start",
      cwd: "C:/work/app",
      model: "sonnet",
      effort: "high",
      permissionMode,
      outputStyle: "Concise",
    };
    const switchMode = { type: "session.setPermissionMode", permissionMode };

    expect(appMessageSchema.parse(start)).toMatchObject(start);
    expect(appMessageSchema.parse(switchMode)).toMatchObject(switchMode);
  });

  test.each([...BUILT_IN_OUTPUT_STYLES, "My custom style"])("accepts output style %s when starting", (outputStyle) => {
    const start = {
      type: "session.start",
      cwd: "C:/work/app",
      model: "sonnet",
      effort: "high",
      permissionMode: "auto",
      outputStyle,
    };
    expect(appMessageSchema.parse(start)).toMatchObject(start);
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
        "commit.generate",
      ]),
    );
  });

  test("keeps commit.generate fields intact, including an empty diff", () => {
    const parsed = appMessageSchema.parse({ ...commitGenerate, patch: "", truncated: true });
    expect(parsed).toEqual({ ...commitGenerate, patch: "", truncated: true });
  });

  test("drops unknown fields so additive changes stay compatible", () => {
    const parsed = appMessageSchema.parse({ type: "interrupt", extra: true });
    expect(parsed).toEqual({ type: "interrupt" });
  });
});
