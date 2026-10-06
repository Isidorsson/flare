import { PERMISSION_MODES, outputStyleSchema, permissionModeSchema } from "@flare/protocol";

import {
  PERMISSION_MODE_DESCRIPTIONS,
  PERMISSION_MODE_LABELS,
  mergeOutputStyles,
  outputStyleLabel,
} from "@/features/agent/session-settings";
import { useAgent } from "@/features/agent/use-agent";
import { Tooltip } from "@/shared/ui/Tooltip";

import { ModelEffortMenu } from "./ModelEffortMenu";

interface PickerProps<T extends string> {
  label: string;
  hint: string;
  detail: string;
  value: T;
  options: readonly T[];
  labelOf: (option: T) => string;
  parse: (value: string) => T;
  onChange: (value: T) => void;
}

function Picker<T extends string>({ label, hint, detail, value, options, labelOf, parse, onChange }: PickerProps<T>) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span>{label}</span>
      <Tooltip content={hint} detail={detail} side="top">
        <select
          value={value}
          onChange={(event) => {
            onChange(parse(event.target.value));
          }}
          className="h-6 rounded-md border border-border bg-surface-2 px-1.5 text-xs text-fg outline-none hover:border-border-strong focus-visible:border-accent"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {labelOf(option)}
            </option>
          ))}
        </select>
      </Tooltip>
    </label>
  );
}

export function SessionPicker() {
  const settings = useAgent((state) => state.settings);
  const outputStyles = useAgent((state) => state.outputStyles);
  const changeSettings = useAgent((state) => state.changeSettings);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <ModelEffortMenu model={settings.model} effort={settings.effort} onChange={changeSettings} />
      <Picker
        label="Permissions"
        hint="Choose how Claude asks for permission"
        detail={PERMISSION_MODE_DESCRIPTIONS[settings.permissionMode]}
        value={settings.permissionMode}
        options={PERMISSION_MODES}
        labelOf={(mode) => PERMISSION_MODE_LABELS[mode]}
        parse={(value) => permissionModeSchema.parse(value)}
        onChange={(permissionMode) => {
          changeSettings({ permissionMode });
        }}
      />
      <Picker
        label="Style"
        hint="Choose Claude's output style"
        detail="Applies to the next thread you start or resume"
        value={settings.outputStyle}
        options={mergeOutputStyles(outputStyles, [settings.outputStyle])}
        labelOf={outputStyleLabel}
        parse={(value) => outputStyleSchema.parse(value)}
        onChange={(outputStyle) => {
          changeSettings({ outputStyle });
        }}
      />
    </div>
  );
}
