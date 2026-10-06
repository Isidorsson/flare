import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="max-w-64 text-xs text-balance text-fg-muted">{description}</p>
      </div>
    </div>
  );
}
