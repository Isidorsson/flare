import { useEffect, useReducer } from "react";

import { COPY_FEEDBACK_MS, copyToClipboard, copyTransition, type CopyStatus } from "./copy-machine";

const writeToSystemClipboard = (text: string) => navigator.clipboard.writeText(text);

/** Copies `text` on demand. The status reads "copied" or "failed" for a moment, then goes back to idle. */
export function useCopy(text: string): { status: CopyStatus; copy: () => void } {
  const [status, dispatch] = useReducer(copyTransition, "idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => {
      dispatch("reset");
    }, COPY_FEEDBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status]);

  function copy() {
    void copyToClipboard(writeToSystemClipboard, text).then(dispatch);
  }

  return { status, copy };
}
