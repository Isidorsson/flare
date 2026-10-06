import { useEffect, useRef } from "react";

import { LiveEditorController } from "./live/editor-controller";
import { liveStore } from "./live/use-live";
import { filesStore } from "./use-files";

/** Render with `key={path}`: each file gets its own editor, which then follows the stores by itself. */
export function LiveEditor({ path }: { path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const controller = new LiveEditorController({ container, path, files: filesStore, live: liveStore });
    return () => {
      controller.dispose();
    };
  }, [path]);

  return <div ref={containerRef} className="size-full" />;
}
