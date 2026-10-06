export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const PERMISSION_MODES = ["auto", "default", "acceptEdits", "plan"] as const;
// Claude Code's built-in output styles, by the exact names its `outputStyle` setting expects.
export const BUILT_IN_OUTPUT_STYLES = ["default", "Proactive", "Concise", "Explanatory", "Learning"] as const;
export const PERMISSION_DECISIONS = ["allow", "allowSession", "deny"] as const;
export const FILE_CHANGE_KINDS = ["create", "update"] as const;
