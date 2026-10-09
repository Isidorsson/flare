import { z } from "zod";

import { TAB_TITLE_PREFIX } from "./terminal-constants";

const profileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["shell", "claude"]),
});

const profilesSchema = z.array(profileSchema);

export type LaunchProfile = z.infer<typeof profileSchema>;

/** What a tab runs. Mirrors the backend's `Launch`: programs are picked by profile id, never by path. */
export type TerminalLaunch =
  | { kind: "shell"; profile: string | null }
  | { kind: "claude"; resume: string | null };

export interface TabRequest {
  launch: TerminalLaunch;
  label: string;
}

export const DEFAULT_TAB: TabRequest = {
  launch: { kind: "shell", profile: null },
  label: TAB_TITLE_PREFIX,
};

export const CLAUDE_TAB_LABEL = "Claude";

export function parseProfiles(raw: unknown): LaunchProfile[] {
  return profilesSchema.parse(raw);
}

export function shellProfiles(profiles: readonly LaunchProfile[]): LaunchProfile[] {
  return profiles.filter((profile) => profile.kind === "shell");
}

export function hasClaude(profiles: readonly LaunchProfile[]): boolean {
  return profiles.some((profile) => profile.kind === "claude");
}

/** The chosen default when it is still installed, otherwise the system default (the first shell). */
export function resolveDefaultShell(profiles: readonly LaunchProfile[], chosenId: string | null): LaunchProfile | null {
  const shells = shellProfiles(profiles);
  return shells.find((profile) => profile.id === chosenId) ?? shells[0] ?? null;
}

export function shellTab(profile: LaunchProfile | null): TabRequest {
  if (profile === null) return DEFAULT_TAB;
  return { launch: { kind: "shell", profile: profile.id }, label: profile.label };
}

export function claudeTab(resume: string | null): TabRequest {
  return { launch: { kind: "claude", resume }, label: CLAUDE_TAB_LABEL };
}
