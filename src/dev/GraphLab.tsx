import { useEffect, useEffectEvent, useState } from "react";

import { GraphPanel, setAgentStatus, startTurn } from "@/features/graph";

import { FIXTURE_NAMES, type FixtureSize, type ScriptStep } from "./graph-fixtures";
import { applyStep, openFixture, shouldAutoplay, STEP_MS, WIDTH_NAMES, WIDTHS, type WidthName } from "./lab-setup";

function usePlayback(script: readonly ScriptStep[], playing: boolean, onFinish: () => void): void {
  const finish = useEffectEvent(onFinish);
  useEffect(() => {
    if (!playing) return;
    let index = 0;
    startTurn();
    setAgentStatus("working");
    const timer = window.setInterval(() => {
      const step = script[index];
      if (step === undefined) {
        setAgentStatus("done");
        finish();
        return;
      }
      applyStep(step);
      index += 1;
    }, STEP_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [script, playing]);
}

function Choice<T extends string>(props: { value: T; options: readonly T[]; onChange: (value: T) => void }) {
  return (
    <div className="flex rounded-md border border-border bg-surface-1 p-0.5">
      {props.options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={props.value === option}
          onClick={() => {
            props.onChange(option);
          }}
          className={`rounded-sm px-2 py-0.5 text-[11px] ${props.value === option ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg"}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

interface GraphLabProps {
  initialSize: FixtureSize;
  initialScript: readonly ScriptStep[];
}

/** Dev-only harness: the real graph panel on a stubbed backend, with generated projects and a scripted agent. */
export function GraphLab({ initialSize, initialScript }: GraphLabProps) {
  const [size, setSize] = useState<FixtureSize>(initialSize);
  const [script, setScript] = useState<readonly ScriptStep[]>(initialScript);
  const [width, setWidth] = useState<WidthName>("full");
  const [playing, setPlaying] = useState(shouldAutoplay());
  usePlayback(script, playing, () => {
    setPlaying(false);
  });

  function changeSize(next: FixtureSize) {
    setPlaying(false);
    setSize(next);
    setScript(openFixture(next));
  }

  return (
    <div className="flex h-dvh flex-col gap-1 bg-bg p-1 text-fg">
      <div className="flex flex-wrap items-center gap-1">
        <Choice value={size} options={FIXTURE_NAMES} onChange={changeSize} />
        <Choice value={width} options={WIDTH_NAMES} onChange={setWidth} />
        <button
          type="button"
          onClick={() => {
            setPlaying(!playing);
          }}
          className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] hover:bg-surface-3"
        >
          {playing ? "Stop agent" : "Play agent"}
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-border"
        style={{ width: WIDTHS[width] === 0 ? "100%" : WIDTHS[width] }}
      >
        <GraphPanel />
      </div>
    </div>
  );
}
