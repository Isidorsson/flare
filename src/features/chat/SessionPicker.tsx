import { PERMISSION_MODES, outputStyleSchema, permissionModeSchema } from "@flare/protocol";

import { PERMISSION_MODE_LABELS, mergeOutputStyles, outputStyleLabel } from "@/features/agent/session-settings";
import { useAgent } from "@/features/agent/use-agent";

import { ModelEffortMenu } from "./ModelEffortMenu";

interface PickerProps<T extends string> {
  label: string;
  title?: string;
  value: T;
  options: readonly T[];
  labelOf: (option: T) => string;
  parse: (value: string) => T;
  onChange: (value: T) => void;
}

function Picker<T extends string>({ label, title, value, options, labelOf, parse, onChange }: PickerProps<T>) {
  return (
    <label title={title} className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span>{label}</span>
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
        title="Applies from the next session"
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
