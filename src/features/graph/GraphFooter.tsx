import { BLAST_TOKENS, LANGUAGE_TOKENS } from "./palette";
import { baseName } from "./graph-paths";
import { LANGUAGES, type Language } from "./graph-types";
import { useGraph } from "./use-graph";

const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  python: "Python",
  lua: "Lua",
  luau: "Luau",
  go: "Go",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  java: "Java",
  kotlin: "Kotlin",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  dart: "Dart",
  zig: "Zig",
  shell: "Shell",
  css: "CSS",
  vue: "Vue",
  svelte: "Svelte",
};

const BLAST_LEGEND = [
  { token: BLAST_TOKENS.origin, label: "Selected" },
  { token: BLAST_TOKENS.depths[0], label: "Direct" },
  { token: BLAST_TOKENS.depths[1], label: "2 hops" },
  { token: BLAST_TOKENS.depths[2], label: "3+ hops" },
] as const;

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: `var(${token})` }} />
      {label}
    </li>
  );
}

function Legend({ items }: { items: readonly { token: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <Swatch key={item.label} {...item} />
      ))}
    </ul>
  );
}

function blastMessage(origin: string, dependents: number | null): string {
  if (dependents === null) return `Tracing dependents of ${baseName(origin)}…`;
  if (dependents === 0) return `Nothing imports ${baseName(origin)}`;
  const noun = dependents === 1 ? "file depends" : "files depend";
  return `${dependents} ${noun} on ${baseName(origin)}`;
}

function BlastFooter() {
  const blast = useGraph((state) => state.blast);
  if (blast === null) {
    return <p>Click a file to see everything that depends on it.</p>;
  }
  return (
    <div className="space-y-1">
      <p role="status" className="text-fg">
        {blastMessage(blast.origin, blast.depths?.size ?? null)}
      </p>
      <Legend items={BLAST_LEGEND} />
    </div>
  );
}

function LanguageLegend() {
  const present = useGraph((state) => state.snapshot?.nodes ?? null);
  const used = new Set(present?.map((node) => node.language));
  const items = LANGUAGES.filter((language) => used.has(language)).map((language) => ({
    token: LANGUAGE_TOKENS[language],
    label: LANGUAGE_LABELS[language],
  }));
  return <Legend items={items} />;
}

export function GraphFooter() {
  const mode = useGraph((state) => state.mode);
  const colorBy = useGraph((state) => state.colorBy);
  const content =
    mode === "blast" ? <BlastFooter /> : colorBy === "language" ? <LanguageLegend /> : <p>Colour groups files by folder.</p>;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2">
      <div className="pointer-events-auto inline-block max-w-full rounded-md border border-border bg-surface-1/90 px-2.5 py-1.5 text-xs text-fg-muted backdrop-blur">
        {content}
      </div>
    </div>
  );
}
