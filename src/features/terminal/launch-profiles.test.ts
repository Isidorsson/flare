import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TAB,
  claudeTab,
  hasClaude,
  parseProfiles,
  resolveDefaultShell,
  shellProfiles,
  shellTab,
  type LaunchProfile,
} from "./launch-profiles";

const pwsh: LaunchProfile = { id: "pwsh", label: "PowerShell", kind: "shell" };
const bash: LaunchProfile = { id: "git-bash", label: "Git Bash", kind: "shell" };
const claude: LaunchProfile = { id: "claude", label: "Claude Code", kind: "claude" };
const profiles = [pwsh, bash, claude];

describe("launch profiles", () => {
  test("parses the backend list and rejects unknown kinds", () => {
    expect(parseProfiles(profiles)).toEqual(profiles);
    expect(() => parseProfiles([{ id: "x", label: "X", kind: "program" }])).toThrow();
    expect(() => parseProfiles([{ id: "", label: "X", kind: "shell" }])).toThrow();
  });

  test("separates shells from Claude Code", () => {
    expect(shellProfiles(profiles)).toEqual([pwsh, bash]);
    expect(hasClaude(profiles)).toBe(true);
    expect(hasClaude([pwsh])).toBe(false);
  });

  test("uses the chosen default shell while it is installed", () => {
    expect(resolveDefaultShell(profiles, "git-bash")).toEqual(bash);
  });

  test("falls back to the first shell when nothing or a missing shell was chosen", () => {
    expect(resolveDefaultShell(profiles, null)).toEqual(pwsh);
    expect(resolveDefaultShell(profiles, "zsh")).toEqual(pwsh);
    expect(resolveDefaultShell(profiles, "claude")).toEqual(pwsh);
    expect(resolveDefaultShell([], null)).toBeNull();
  });

  test("builds tab requests for shells and Claude Code", () => {
    expect(shellTab(bash)).toEqual({ launch: { kind: "shell", profile: "git-bash" }, label: "Git Bash" });
    expect(shellTab(null)).toEqual(DEFAULT_TAB);
    expect(claudeTab("s1")).toEqual({ launch: { kind: "claude", resume: "s1" }, label: "Claude" });
    expect(claudeTab(null).launch).toEqual({ kind: "claude", resume: null });
  });
});
