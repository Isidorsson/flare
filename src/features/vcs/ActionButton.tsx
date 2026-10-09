import { LoaderCircle, type LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { Tooltip } from "@/shared/ui/Tooltip";

type Variant = "primary" | "secondary";

interface ActionButtonProps {
  label: string;
  /** What pressing it does, for the tooltip. */
  hint: string;
  /** A second tooltip line for what the hint cannot say; replaced by the reason while the button is blocked. */
  detail?: string | undefined;
  icon?: LucideIcon | undefined;
  variant?: Variant;
  shortcut?: string | undefined;
  /** Why it cannot be pressed now. The button stays focusable so the tooltip can say so. */
  blockedReason: string | null;
  /** The action it runs is in progress: shows a spinner in place of the icon. */
  working?: boolean;
  onPress: () => void;
}

const BASE =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors";

const ENABLED: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface-3 text-fg hover:bg-border-strong",
};

const BLOCKED: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg opacity-40",
  secondary: "bg-surface-3 text-fg opacity-40",
};

function ignoreClick(event: MouseEvent) {
  event.preventDefault();
}

function Glyph({ icon: Icon, working }: { icon: LucideIcon | undefined; working: boolean }) {
  if (working) return <LoaderCircle aria-hidden className="size-3.5 animate-spin" />;
  return Icon === undefined ? null : <Icon aria-hidden className="size-3.5" />;
}

/** A text button whose tooltip says why it is unavailable, since a natively disabled button cannot be hovered. */
export function ActionButton({
  label,
  hint,
  detail,
  icon,
  variant = "secondary",
  shortcut,
  blockedReason,
  working = false,
  onPress,
}: ActionButtonProps) {
  const blocked = blockedReason !== null;
  return (
    <Tooltip content={hint} detail={blockedReason ?? detail} shortcut={blocked ? undefined : shortcut} side="top">
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-busy={working || undefined}
        onClick={blocked ? ignoreClick : onPress}
        className={`${BASE} ${blocked ? BLOCKED[variant] : ENABLED[variant]}`}
      >
        <Glyph icon={icon} working={working} />
        {label}
      </button>
    </Tooltip>
  );
}
