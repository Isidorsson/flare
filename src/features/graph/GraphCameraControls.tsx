import { Crosshair } from "lucide-react";

import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { graphStore, useGraph } from "./use-graph";

const ACTIVE_CLASS = "bg-accent-soft! text-accent! hover:bg-accent-soft! hover:text-accent!";

function FitButton() {
  return (
    <Tooltip content="Fit the whole graph in view">
      <button
        type="button"
        onClick={() => {
          graphStore.getState().fitCamera();
        }}
        className="rounded-sm bg-surface-3 px-2 py-0.5 text-xs text-fg transition-colors hover:bg-border-strong"
      >
        Fit
      </button>
    </Tooltip>
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
        label="Follow the agent's position"
        aria-pressed={follow}
        onClick={() => {
          graphStore.getState().toggleFollow();
        }}
        className={follow ? ACTIVE_CLASS : ""}
      />
    </>
  );
}
