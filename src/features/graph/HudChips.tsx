import { hudStats } from "./activity-summary";
import { useGraph } from "./use-graph";

function Chip({ value, label, tone = "text-fg" }: { value: number; label: string; tone?: string }) {
  return (
    <li className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-fg-subtle tabular-nums">
      <span className={`font-semibold ${tone}`}>{value}</span> {label}
    </li>
  );
}

export function HudChips() {
  const files = useGraph((state) => state.snapshot?.nodes.length ?? 0);
  const nodes = useGraph((state) => state.activity.nodes);
  const turnLines = useGraph((state) => state.activity.turnLines);
  const stats = hudStats(nodes, turnLines, files);
  const active = stats.visited > 0;
  return (
    <ul aria-label="Graph summary" className="flex min-w-0 flex-wrap items-center gap-1">
      <Chip value={stats.files} label="files" />
      {active ? <Chip value={stats.visited} label="visited" /> : null}
      {active ? <Chip value={stats.edited} label="edited" tone="text-activity-edit" /> : null}
      {active ? <Chip value={stats.readOnly} label="read only" tone="text-activity-read" /> : null}
      {stats.turnLines > 0 ? <Chip value={stats.turnLines} label="lines this turn" tone="text-activity-create" /> : null}
    </ul>
  );
}
