import type { LucideIcon } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";

import { Tooltip, type TooltipSide } from "./Tooltip";

interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label" | "title" | "disabled"> {
  icon: LucideIcon;
  /** Names the button for assistive tech and for the tooltip: say what pressing it does. */
  label: string;
  shortcut?: string | undefined;
  /** Set while the button cannot be used. It stays hoverable and focusable so the tooltip can say why. */
  disabledReason?: string | undefined;
  side?: TooltipSide | undefined;
}

const BASE = "inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors";
const ENABLED = "hover:bg-surface-3 hover:text-fg";
const DISABLED = "opacity-40";

function ignoreClick(event: MouseEvent) {
  event.preventDefault();
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  disabledReason,
  side,
  className = "",
  onClick,
  ...rest
}: IconButtonProps) {
  const disabled = disabledReason !== undefined;
  return (
    <Tooltip content={label} detail={disabledReason} shortcut={disabled ? undefined : shortcut} side={side}>
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={disabled ? ignoreClick : onClick}
        className={`${BASE} ${disabled ? DISABLED : ENABLED} ${className}`}
        {...rest}
      >
        <Icon aria-hidden className="size-4" />
      </button>
    </Tooltip>
  );
}
