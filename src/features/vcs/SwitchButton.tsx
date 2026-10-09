import { Tooltip } from "@/shared/ui/Tooltip";

interface SwitchButtonProps {
  label: string;
  checked: boolean;
  /** What the switch does, for the tooltip. */
  hint: string;
  /** What each position means, for the tooltip's second line. */
  detail: string;
  onChange: (checked: boolean) => void;
}

/** A labelled on/off switch with a tooltip. */
export function SwitchButton({ label, checked, hint, detail, onChange }: SwitchButtonProps) {
  return (
    <Tooltip content={hint} detail={detail} side="top">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => {
          onChange(!checked);
        }}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
          checked ? "text-accent" : "text-fg-muted hover:text-fg"
        }`}
      >
        {label}
        <span
          aria-hidden
          className={`relative h-3.5 w-6 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border-strong"}`}
        >
          <span
            className={`absolute top-0.5 size-2.5 rounded-full bg-bg transition-[left] ${checked ? "left-3" : "left-0.5"}`}
          />
        </span>
      </button>
    </Tooltip>
  );
}
