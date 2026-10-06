import {
  EFFORT_LEVELS,
  PERMISSION_MODES,
  RESPONSE_STYLES,
  effortSchema,
  permissionModeSchema,
  responseStyleSchema,
} from "@flare/protocol";

import {
  EFFORT_LABELS,
  MODEL_IDS,
  MODEL_LABELS,
  PERMISSION_MODE_LABELS,
  RESPONSE_STYLE_LABELS,
  modelSchema,
} from "@/features/agent/session-settings";
import { useAgent } from "@/features/agent/use-agent";

interface PickerProps<T extends string> {
  label: string;
  title?: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  parse: (value: string) => T;
  onChange: (value: T) => void;
}

function Picker<T extends string>({ label, title, value, options, labels, parse, onChange }: PickerProps<T>) {
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
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SessionPicker() {
  const settings = useAgent((state) => state.settings);
  const changeSettings = useAgent((state) => state.changeSettings);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Picker
        label="Model"
        value={settings.model}
        options={MODEL_IDS}
        labels={MODEL_LABELS}
        parse={(value) => modelSchema.parse(value)}
        onChange={(model) => {
          changeSettings({ model });
        }}
      />
      <Picker
        label="Effort"
        value={settings.effort}
        options={EFFORT_LEVELS}
        labels={EFFORT_LABELS}
        parse={(value) => effortSchema.parse(value)}
        onChange={(effort) => {
          changeSettings({ effort });
        }}
      />
      <Picker
        label="Permissions"
        value={settings.permissionMode}
        options={PERMISSION_MODES}
        labels={PERMISSION_MODE_LABELS}
        parse={(value) => permissionModeSchema.parse(value)}
        onChange={(permissionMode) => {
          changeSettings({ permissionMode });
        }}
      />
      <Picker
        label="Style"
        title="Applies from the next session"
        value={settings.responseStyle}
        options={RESPONSE_STYLES}
        labels={RESPONSE_STYLE_LABELS}
        parse={(value) => responseStyleSchema.parse(value)}
        onChange={(responseStyle) => {
          changeSettings({ responseStyle });
        }}
      />
    </div>
  );
}
