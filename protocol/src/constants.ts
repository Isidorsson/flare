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

// Commit messages are written by a small, fast model in a one-shot query that is independent of the chat session.
export const COMMIT_MESSAGE_MODEL = "claude-haiku-5-5";
export const COMMIT_SUBJECT_MAX_CHARS = 72;
export const COMMIT_BODY_WRAP_CHARS = 72;
export const MAX_COMMIT_RECENT_SUBJECTS = 20;
// The diff is cut to this many characters before it reaches the model, however much the app sent.
export const COMMIT_PROMPT_MAX_PATCH_CHARS = 60_000;
// The bridge gives up on a hung generation first, so its reason reaches the app before the app's own timeout fires.
export const COMMIT_MESSAGE_BRIDGE_TIMEOUT_MS = 45_000;
export const COMMIT_MESSAGE_APP_TIMEOUT_MS = COMMIT_MESSAGE_BRIDGE_TIMEOUT_MS + 15_000;
