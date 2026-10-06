import type { ComponentProps } from "react";

type ChatButtonVariant = "primary" | "secondary" | "danger";

interface ChatButtonProps extends Omit<ComponentProps<"button">, "className"> {
  variant?: ChatButtonVariant;
}

const VARIANT_CLASSES: Record<ChatButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface-3 text-fg hover:bg-border-strong",
  danger: "bg-transparent text-danger hover:bg-surface-3",
};

export function ChatButton({ variant = "secondary", type = "button", ...rest }: ChatButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${VARIANT_CLASSES[variant]}`}
      {...rest}
    />
  );
}
