# Flare: plan

A Windows-first Tauri 2 desktop app that drives the user's installed Claude Code. The chat sits in the centre. A live file panel follows the agent's reads and edits, a code graph lights up as the agent moves through the project, and a terminal drawer runs underneath. The goal is the GhosttyEXTREME experience with t3code's agent plumbing, rebuilt for Windows.

## Research findings

| Source | What we take | What we leave |
|---|---|---|
| GhosttyEXTREME (AGPL-3.0, macOS-only Swift) | Ideas and UX mechanics only: agent sidebar with live status, editor following the agent's reads and edits, a "star map" code graph, blast radius, review inbox | All code, and its colour scheme. Copying code would make us AGPL. |
| t3code (MIT, Electron + Node server) | The Claude adapter pattern (`ClaudeAdapterV2.ts`): one long-lived `query()` fed by a message queue, `includePartialMessages`, `canUseTool` waiting on a UI decision, `resume`/`forkSession`, Edit/Write/MultiEdit mapped to `file_change`, git hidden-ref checkpoints | Effect RPC, the multi-provider orchestration, the Electron shell |
| Upstream Ghostty | `ghostty-web` (MIT): Ghostty's VT parser compiled to WASM, with an xterm.js-compatible API | Native Ghostty renderer (no Windows GUI exists) |
| Claude Agent SDK (TS) | The only first-party programmatic driver. Takes `pathToClaudeCodeExecutable`, `effort`, `setModel()`, `interrupt()`, `canUseTool`, `settings.outputStyle`, `initializationResult().available_output_styles` | There is no official Rust SDK, so we need a TS sidecar |

**How GhosttyEXTREME shows agent activity** (researched 2026-10-06): edits come from a file watcher diffed against a turn-start snapshot and are replayed as a line-by-line reveal after they land; reads come from tailing the transcript JSONL. Flare goes further by streaming the Edit tool's input as the model writes it (`file.editing`).

**Auth:** we spawn the user's own `claude` binary, which uses their existing login. That is fine for personal use, the same way t3code works. Anthropic does not allow *distributing* a product that offers claude.ai login, so a public release would need API-key auth instead.

## Architecture

```
┌──────────────── Tauri WebView (React + TS + Tailwind) ─────────────────┐
│ Threads │        Chat (stream, tools, approvals)      │ Files | Graph  │
│ sidebar │                                             │ | Split (tabs) │
│         ├─────────────── Terminal drawer (ghostty-web) ────────────────┤
└──────────────▲───────────────────────────── Tauri Channels / invoke ───┘
               │
┌──────────────┴──────────── Rust core (src-tauri) ──────────────────────┐
│ bridge/     spawn/own sidecar, relay NDJSON <-> Channel (no parsing)   │
│ pty/        portable-pty (ConPTY) sessions                             │
│ proctree/   Windows Job Objects: every spawned tree dies with Flare    │
│ fs/         read/write/list (ignore crate), notify watcher hub         │
│ graph/      tree-sitter import graph, incremental, blast radius        │
└──────────────▲─────────────────────────────────────────────────────────┘
               │ stdio NDJSON
┌──────────────┴──── bridge/ (Bun sidecar) ──────────────────────────────┐
│ @anthropic-ai/claude-agent-sdk → spawns user's `claude` executable     │
│ Normalises SDK messages into the Flare protocol (zod-validated)        │
│ Dev: run from source with bun. Release: `bun build --compile` sidecar  │
└────────────────────────────────────────────────────────────────────────┘
```

Rust only *relays* agent messages. The protocol has a single source of truth: zod schemas in `protocol/`, shared by the bridge and the frontend. Rust owns everything that is native: processes, PTY, filesystem and graph indexing.

### Bridge protocol (NDJSON, every line `{ type, ... }`)

App → bridge
- `session.start { cwd, model, effort, permissionMode, outputStyle, resume? }`
- `user.message { text }`
- `permission.respond { requestId, decision: "allow" | "allowSession" | "deny" }`
- `interrupt`
- `session.setModel { model }`, `session.setEffort { effort }`, `session.setPermissionMode { permissionMode }`

Bridge → app
- `session.ready { sessionId }` and `session.outputStyles { available }`
- `turn.started` and `turn.completed { costUsd, usage }`
- `assistant.delta { text }` and `assistant.message { id, text }`
- `tool.started { toolUseId, name, input }` and `tool.finished { toolUseId, isError, summary }`
- `file.read { toolUseId, path, range?, pattern?, matchLines? }` (Read/Grep/Glob)
- `file.editing { toolUseId, path, kind, oldString?, text }`: the Edit/Write input streamed while the model writes it, throttled to 50 ms
- `file.change { toolUseId, path, kind, before, after }`: `before` captured in a PreToolUse hook, `after` when the tool finishes; sent before `tool.finished`
- `permission.request { requestId, toolName, input }`
- `error { message, fatal? }`

Settings: permission modes `auto` (default) | `default` | `acceptEdits` | `plan`; output styles are Claude Code's built-ins (`default`, Proactive, Concise (default), Explanatory, Learning) plus any custom styles the CLI reports; default model Opus at medium effort.

## Repo layout

```
Flare/
  src/            React app (features: agent/, agent-wiring/, chat/, files/, graph/, terminal/, threads/, right-panel/, shell/, workspace/)
  src-tauri/      Rust core (bridge/, pty/, proctree/, fs/, graph/)
  bridge/         Bun sidecar (Agent SDK adapter)
  protocol/       zod schemas + inferred types (shared)
```

**Stack:** bun, Vite, React 19, Tailwind v4, zustand, `@monaco-editor/react`, `ghostty-web`, `sigma` + `graphology`. Rust: `tauri` 2, `tauri-plugin-shell`, `tauri-plugin-dialog`, `portable-pty`, `windows-sys`, `notify`, `ignore`, `tree-sitter` with grammars for TS/JS, Rust, Python, Lua/Luau, Go, C/C++, C#, Java, Kotlin, Ruby, PHP, Dart, Zig, shell (plus scanners for CSS/SCSS/Less, Vue, Svelte). All dependencies pinned to versions at least 7 days old.

**Checks:** `bun run typecheck` (tsgo), `bun run lint`, `bun test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Do not run `tauri dev` or `tauri build` from agents.

## Status

### Done
- [x] **1. Scaffold.** Tauri 2, Vite, React, Tailwind, resizable shell, terminal drawer, dark theme tokens.
- [x] **2. Agent bridge.** Sidecar, protocol, Rust relay, streaming chat, tool cards, approvals, interrupt, resume, combined model › effort menu, permission picker (Auto default), output-style picker (Concise default). Dev runs the bridge from source so it never goes stale.
- [x] **3. Live file panel.** File tree, Monaco editor and diff, manual edit and save, notify watcher, edit timeline.
- [x] **4. Terminal.** portable-pty + ghostty-web tabs. Every shell and the agent bridge run in a Windows Job Object, so whole process trees die on tab close, close-all or Flare exit/crash. "Close all terminals" button.
- [x] **5. Code graph.** Tree-sitter import graph for 20+ languages, incremental updates driven by the fs watcher, blast radius, sigma.js rendering.
- [x] **Live agent visualisation.**
  - Files: read highlights with "Claude · reading lines a–b", edits typed live as the model streams them with a Claude caret, removed-line ghosts, settle animation, per-turn gutter marks, turn strip ("N files changed +A −R" with replay chips), tab underlines, file-tree heat and 1–5 recency badges, follow mode that never steals focus from the user.
  - Graph: comet with trail and status pill, shockwave rings, slow-cooling heat, dashed path through recent files, particles along import edges, follow-agent camera, Fit.
- [x] **Right panel tabs.** Files | Graph | Split (side by side with a divider). The graph keeps indexing and tracking activity while hidden.
- [x] **Tooltips.** Shared `Tooltip` component; every control has a tooltip, `IconButton` requires a label, disabled buttons explain why.

### Graph redesign (done 2026-10-06)
- [x] Overview level with folders as hubs, touched files as star sparks, untouched files as dust; Files level with import edges; Role / Language / Folder colouring in Flare's own tokens.
- [x] Region glows per folder cluster, legend with counts, HUD chips, comet pill, dashed blast-radius arcs, closable file inspector (activity, imported by, imports, "can affect N files; X tests cover it").
- [x] Nested-disc folder layout replacing ForceAtlas2; premultiplied-alpha edge fix; dev-only lab at `/graph-lab.html` (`?size=small|medium|large&play=1`).
- [ ] Symbols level (needs a symbol index).
- [ ] Inspector: Replay change, this-turn mini diff, symbols list.
- [ ] HUD `+A −R` split (router must pass added/removed counts).
- [ ] Folder hub click behaviour, curved import edges, denser large-project overview.

### Next
- [ ] **6. Polish (original plan).**
  - Git hidden-ref checkpoints and per-turn rollback ("undo this turn").
  - SQLite thread persistence (threads and transcripts survive restarts).
  - Worktrees: run a thread in its own git worktree.
  - EXTREME-style motion: agent status sprites, frame glow while working.
- [x] Markdown rendering for assistant messages (streaming-safe, GFM, Monaco-coloured code, file refs open at line, links via opener).
- [x] Blast-radius toggle applies to the selected file; button audit of ~50 controls.
- [x] Graph edges: one line per file pair, one arc per neighbour, zoom-independent line width, folder links only in overview.
- [ ] Turn-strip replay silently does nothing while the file has unsaved edits.
- [ ] Diff view has no close control when no file tabs are open.
- [ ] Remove the now-unused `graph_blast_radius` command and `blast.rs`.
- [ ] Dedicated cards for `AskUserQuestion` and `ExitPlanMode` (today generic approval cards).
- [ ] Clickable links in the terminal (`tauri-plugin-opener`), right-click paste.
- [ ] Force a full page reload when `src/features/agent/` changes in dev (module-level store survives HMR).
- [ ] Dev-only demo replay: play a recorded agent event sequence to check animations without spending tokens.
- [ ] Output style "New style…": create custom styles in `~/.claude/output-styles`.

### Backlog from the reference screenshots (2026-10-06)
- [ ] **Session sidebar.** Sessions grouped by project, per-agent cards (agent, branch, task, status: Working / Needs permission / Idle, last action, `+A −R`), multiple agents per project, usage bars (5 h / week) at the bottom.
- [ ] **Backend architecture view.** Columns Frontend → Compute → Data → Services as cards (framework, deploy target, bindings, status chips like "Deployed", "Newer commits than the last deploy", "1 migration not applied") with connecting lines; inspector with environments, overview, deployments, out-of-sync warnings, where each binding is used in code.
- [ ] **Database view.** Live schema diagram: tables with columns, types, keys, relation lines; inspector with columns, references, "used in code".
- [ ] **Visual Fix.** Built-in browser pane on the dev server (localhost port picker, device sizes); "Pick" mode: hover any element in the app and click to ask Claude to fix it.
- [ ] **Background process manager.** Everything left running (VMs, containers, agent sessions, browser automation, log followers) with last-used time, memory, "Ready to close" status, Stop/Close buttons and "Close N ready to close"; views Needs attention | Everything | By project. Extends the Job Object work in `proctree/`.
- [ ] **Multiple agents at once.** Editor grid with one pane per active agent, per-agent comet colours, same-file conflict warning.
- [ ] **Review inbox.** Turn-start snapshot (temporary git index + write-tree), per-file accept/undo, line comments, send feedback to the agent, commit/PR.
