import { Crosshair } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";

import { graphStore, useGraph } from "./use-graph";

const ACTIVE_CLASS = "bg-accent-soft! text-accent! hover:bg-accent-soft! hover:text-accent!";

function FitButton() {
  return (
    <button
      type="button"
      onClick={() => {
        graphStore.getState().fitCamera();
      }}
      className="rounded-sm bg-surface-3 px-2 py-0.5 text-xs text-fg transition-colors hover:bg-border-strong"
    >
      Fit
    </button>
  );
}

export function GraphCameraControls() {
  const autoFit = useGraph((state) => state.camera.autoFit);
  const follow = useGraph((state) => state.camera.follow);
  return (
    <>
      {autoFit ? null : <FitButton />}
      <IconButton
        icon={Crosshair}
        label="Follow agent"
        aria-pressed={follow}
        onClick={() => {
          graphStore.getState().toggleFollow();
        }}
        className={follow ? ACTIVE_CLASS : ""}
      />
    </>
  );
}
