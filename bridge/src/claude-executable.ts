export const CLAUDE_PATH_ENV = "FLARE_CLAUDE_PATH";

const WINDOWS_SHIM = /\.(cmd|bat)$/i;

export function resolveClaudeExecutable(
  env: Readonly<Record<string, string | undefined>>,
  which: (command: string) => string | null,
): string {
  const configured = env[CLAUDE_PATH_ENV];
  const path = configured !== undefined && configured !== "" ? configured : which("claude");
  if (path === null) {
    throw new Error(`Could not find \`claude\` on PATH. Install Claude Code or set ${CLAUDE_PATH_ENV} to its executable.`);
  }
  if (WINDOWS_SHIM.test(path)) {
    throw new Error(`${path} is a shell shim that cannot be spawned directly. Set ${CLAUDE_PATH_ENV} to claude.exe.`);
  }
  return path;
}
