export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const PERMISSION_MODES = ["auto", "default", "acceptEdits", "plan"] as const;
// Claude Code's built-in output styles, by the exact names its `outputStyle` setting expects.
export const BUILT_IN_OUTPUT_STYLES = ["default", "Proactive", "Concise", "Explanatory", "Learning"] as const;
export const PERMISSION_DECISIONS = ["allow", "allowSession", "deny"] as const;
export const FILE_CHANGE_KINDS = ["create", "update"] as const;
export const FILE_EDITING_KINDS = ["edit", "write"] as const;
// Highest number of matching lines a single-file search reports, so one event stays small.
export const MAX_MATCH_LINES = 200;
// Streaming edit previews stop growing past this; the final file.change still carries everything.
export const MAX_EDITING_TEXT_CHARS = 20_000;
