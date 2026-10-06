import { EFFORT_LEVELS, PERMISSION_MODES, effortSchema, permissionModeSchema } from "@flare/protocol";
import type { ReactNode } from "react";

import {
  EFFORT_LABELS,
  MODEL_IDS,
  MODEL_LABELS,
  PERMISSION_MODE_LABELS,
  modelSchema,
} from "@/features/agent/session-settings";
import { useAgent } from "@/features/agent/use-agent";

interface PickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

function Picker({ label, value, onChange, children }: PickerProps) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-6 rounded-md border border-border bg-surface-2 px-1.5 text-xs text-fg outline-none hover:border-border-strong focus-visible:border-accent"
      >
        {children}
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
        onChange={(value) => {
          changeSettings({ model: modelSchema.parse(value) });
        }}
      >
        {MODEL_IDS.map((id) => (
          <option key={id} value={id}>
            {MODEL_LABELS[id]}
          </option>
        ))}
      </Picker>
      <Picker
        label="Effort"
        value={settings.effort}
        onChange={(value) => {
          changeSettings({ effort: effortSchema.parse(value) });
        }}
      >
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {EFFORT_LABELS[level]}
          </option>
        ))}
      </Picker>
      <Picker
        label="Permissions"
        value={settings.permissionMode}
        onChange={(value) => {
          changeSettings({ permissionMode: permissionModeSchema.parse(value) });
        }}
      >
        {PERMISSION_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {PERMISSION_MODE_LABELS[mode]}
          </option>
        ))}
      </Picker>
    </div>
  );
}
