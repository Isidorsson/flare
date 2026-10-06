import { EFFORT_LEVELS, type Effort } from "@flare/protocol";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import {
  EFFORT_DESCRIPTIONS,
  EFFORT_LABELS,
  MODEL_DESCRIPTIONS,
  MODEL_IDS,
  MODEL_LABELS,
  type Model,
} from "@/features/agent/session-settings";
import { anchorNameFor } from "@/shared/ui/anchor-name";
import { Tooltip } from "@/shared/ui/Tooltip";

import { columnAfterArrow, columnOfRole, type MenuColumn } from "./menu-keys";

interface ModelEffortMenuProps {
  model: Model;
  effort: Effort;
  onChange: (choice: { model: Model; effort: Effort }) => void;
}

const ITEM =
  "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-fg hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none";

const COLUMN_TARGET: Record<MenuColumn, string> = {
  models: '[role="menuitem"][aria-expanded="true"]',
  efforts: '[role="menuitemradio"]',
};

function focusColumn(menu: HTMLElement | null, column: MenuColumn) {
  const entries = [...(menu?.querySelectorAll<HTMLElement>(COLUMN_TARGET[column]) ?? [])];
  const checked = entries.find((entry) => entry.getAttribute("aria-checked") === "true");
  (checked ?? entries[0])?.focus();
}

export function ModelEffortMenu({ model, effort, onChange }: ModelEffortMenuProps) {
  const menuId = useId();
  const anchor = anchorNameFor("model-menu", menuId);
  const popover = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<Model>(model);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const { target } = event;
    const from = target instanceof HTMLElement ? columnOfRole(target.getAttribute("role")) : null;
    const to = from === null ? null : columnAfterArrow(event.key, from);
    if (to === null) return;
    event.preventDefault();
    focusColumn(popover.current, to);
  }

  return (
    <>
      <Tooltip content="Choose the model and how hard it thinks" side="top">
        <button
          type="button"
          popoverTarget={menuId}
          style={{ anchorName: anchor }}
          className="flex h-6 items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 text-xs text-fg hover:border-border-strong focus-visible:border-accent focus-visible:outline-none"
        >
          {MODEL_LABELS[model]}
          <span className="text-fg-subtle">· {EFFORT_LABELS[effort]}</span>
          <ChevronDown aria-hidden className="size-3 text-fg-subtle" />
        </button>
      </Tooltip>
      <div
        id={menuId}
        ref={popover}
        popover="auto"
        role="menu"
        aria-label="Model and effort"
        onToggle={(event) => {
          if (event.newState === "open") setHighlighted(model);
        }}
        onKeyDown={handleKeyDown}
        style={{ positionAnchor: anchor, positionArea: "top span-right" }}
        className="inset-auto m-0 mb-1 gap-1 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-lg open:flex"
      >
        <ModelList
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onEnter={() => {
            focusColumn(popover.current, "efforts");
          }}
        />
        <EffortList
          model={highlighted}
          checked={highlighted === model ? effort : null}
          onChoose={(nextEffort) => {
            onChange({ model: highlighted, effort: nextEffort });
            popover.current?.hidePopover();
          }}
        />
      </div>
    </>
  );
}

interface ModelListProps {
  highlighted: Model;
  onHighlight: (model: Model) => void;
  onEnter: () => void;
}

function ModelList({ highlighted, onHighlight, onEnter }: ModelListProps) {
  return (
    <ul className="w-28">
      {MODEL_IDS.map((id) => (
        <li key={id}>
          <Tooltip content={MODEL_DESCRIPTIONS[id]} detail="Pick an effort level to switch to it" side="left">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={id === highlighted}
              onPointerEnter={() => {
                onHighlight(id);
              }}
              onFocus={() => {
                onHighlight(id);
              }}
              onClick={() => {
                onHighlight(id);
                onEnter();
              }}
              className={`${ITEM} ${id === highlighted ? "bg-surface-3" : ""}`}
            >
              <span className="flex-1">{MODEL_LABELS[id]}</span>
              <ChevronRight aria-hidden className="size-3 text-fg-subtle" />
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

interface EffortListProps {
  model: Model;
  checked: Effort | null;
  onChoose: (effort: Effort) => void;
}

function EffortList({ model, checked, onChoose }: EffortListProps) {
  return (
    <ul role="menu" aria-label={`${MODEL_LABELS[model]} effort`} className="w-32 border-l border-border pl-1">
      {EFFORT_LEVELS.map((level) => (
        <li key={level}>
          <Tooltip content={EFFORT_DESCRIPTIONS[level]} side="right">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={level === checked}
              onClick={() => {
                onChoose(level);
              }}
              className={ITEM}
            >
              <span className="flex-1">{EFFORT_LABELS[level]}</span>
              {level === checked ? <Check aria-hidden className="size-3 text-accent" /> : null}
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
