export type CopyStatus = "idle" | "copied" | "failed";
export type CopyEvent = "copied" | "failed" | "reset";

export const COPY_FEEDBACK_MS = 1500;

const LABELS: Record<CopyStatus, string> = {
  idle: "Copy code",
  copied: "Copied",
  failed: "Could not copy",
};

export function copyLabel(status: CopyStatus): string {
  return LABELS[status];
}

export function copyTransition(_status: CopyStatus, event: CopyEvent): CopyStatus {
  return event === "reset" ? "idle" : event;
}

export type ClipboardWriter = (text: string) => Promise<void>;

/** Writes `text` and says how it went. A refusal is reported (to the console and as `failed`), never thrown. */
export async function copyToClipboard(write: ClipboardWriter, text: string): Promise<"copied" | "failed"> {
  try {
    await write(text);
    return "copied";
  } catch (error) {
    console.error("flare: copying to the clipboard failed", error);
    return "failed";
  }
}
