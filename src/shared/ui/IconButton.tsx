import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label"> {
  icon: LucideIcon;
  label: string;
}

export function IconButton({ icon: Icon, label, className = "", ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...rest}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
