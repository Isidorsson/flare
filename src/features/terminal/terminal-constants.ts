export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_SCROLLBACK_LINES = 10_000;
export const TERMINAL_RESIZE_DEBOUNCE_MS = 80;

export const INITIAL_COLS = 80;
export const INITIAL_ROWS = 24;

export const TAB_TITLE_PREFIX = "Terminal";
export const TAB_TITLE_MAX_LENGTH = 40;

export const TERMINAL_HOST_CLASS = "absolute inset-0 overflow-hidden bg-bg px-2 py-1.5";

export const PTY_COMMANDS = {
  profiles: "pty_profiles",
  spawn: "pty_spawn",
  write: "pty_write",
  resize: "pty_resize",
  kill: "pty_kill",
  killAll: "pty_kill_all",
} as const;
