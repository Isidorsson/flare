# Flare: plan

A Windows-first Tauri 2 desktop app that drives the user's installed Claude Code. The chat sits in the centre. A live file panel follows the agent's reads and edits, a code graph lights up as the agent moves through the project, and a terminal drawer runs underneath. The goal is the GhosttyEXTREME experience with t3code's agent plumbing, rebuilt for Windows.

## Research findings

| Source | What we take | What we leave |
|---|---|---|
| GhosttyEXTREME (AGPL-3.0, macOS-only Swift) | Ideas: agent sidebar with live status, Monaco following the agent's reads and edits, a "star map" code graph, blast radius, review inbox | All code. It is Swift/SwiftUI/Core Animation, and copying it would make us AGPL. |
| t3code (MIT, Electron + Node server) | The Claude adapter pattern (`ClaudeAdapterV2.ts`): one long-lived `query()` fed by a message queue, `includePartialMessages`, `canUseTool` waiting on a UI decision, `resume`/`forkSession`, Edit/Write/MultiEdit mapped to `file_change`, git hidden-ref checkpoints | Effect RPC, the multi-provider orchestration, the Electron shell |
| Upstream Ghostty | `ghostty-web` (MIT): Ghostty's VT parser compiled to WASM, with an xterm.js-compatible API | Native Ghostty renderer (no Windows GUI exists) |
| Claude Agent SDK (TS) | The only first-party programmatic driver. Takes `pathToClaudeCodeExecutable`, `effort: "low"…"max"`, `setModel()`, `interrupt()`, `canUseTool` | There is no official Rust SDK, so we need a TS sidecar |

**Auth:** we spawn the user's own `claude` binary (v2.1.291 is installed), which uses their existing login. That is fine for personal use, the same way t3code works. Anthropic does not allow *distributing* a product that offers claude.ai login, so a public release would need API-key auth instead.

## Architecture

```
┌──────────────── Tauri WebView (React + TS + Tailwind) ─────────────────┐
│ Threads │        Chat (stream, tools, approvals)      │ Files │ Graph  │
│ sidebar │                                             │ Monaco diff /  │
│         │                                             │ sigma.js graph │
│         ├─────────────── Terminal drawer (ghostty-web) ────────────────┤
└──────────────▲───────────────────────────── Tauri Channels / invoke ───┘
               │
┌──────────────┴──────────── Rust core (src-tauri) ──────────────────────┐
│ bridge.rs   spawn/own sidecar, relay NDJSON <-> Channel (no parsing)   │
│ pty.rs      portable-pty (ConPTY) sessions                             │
│ fs.rs       read/write/list (ignore crate), notify watcher             │
│ graph/      tree-sitter import graph, incremental, blast radius        │
└──────────────▲─────────────────────────────────────────────────────────┘
               │ stdio NDJSON
┌──────────────┴──── bridge/ (Bun sidecar, `bun build --compile`) ───────┐
│ @anthropic-ai/claude-agent-sdk → spawns user's `claude` executable     │
│ Normalises SDK messages into the Flare protocol (zod-validated)        │
└────────────────────────────────────────────────────────────────────────┘
```

Rust only *relays* agent messages. The protocol has a single source of truth: zod schemas in `protocol/`, shared by the bridge and the frontend. Rust owns everything that is native: processes, PTY, filesystem and graph indexing.

### Bridge protocol (NDJSON, every line `{ type, ... }`)

App → bridge
- `session.start { cwd, model, effort, permissionMode, resume? }`
- `user.message { text }`
- `permission.respond { requestId, decision: "allow" | "allowSession" | "deny" }`
- `interrupt`
- `session.setModel { model }`

Bridge → app
- `session.ready { sessionId }`
- `assistant.delta { text }` and `assistant.message { id, text }`
- `tool.started { toolUseId, name, input }` and `tool.finished { toolUseId, isError, summary }`
- `file.read { toolUseId, path }` (from the Read/Grep/Glob tools; drives graph highlighting)
- `file.change { toolUseId, path, kind, before, after }`. `before` is captured when the tool starts and `after` when it finishes.
- `permission.request { requestId, toolName, input }`
- `turn.completed { costUsd, usage }`
- `error { message }`

## Repo layout

```
Flare/
  src/            React app (features: chat/, files/, graph/, terminal/, threads/)
  src-tauri/      Rust core (bridge.rs, pty.rs, fs.rs, graph/)
  bridge/         Bun sidecar (Agent SDK adapter)
  protocol/       zod schemas + inferred types (shared)
```

**Stack:** bun, Vite, React 19, Tailwind v4, zustand, `@monaco-editor/react` (with its DiffEditor), `ghostty-web`, `sigma` + `graphology`. On the Rust side: `tauri` 2, `tauri-plugin-shell`, `portable-pty`, `notify`, `ignore`, `tree-sitter` with the TS/JS/Rust/Python grammars, and `serde`. Pick stable versions that are at least 7 days old.

**Checks:** `bun run typecheck` (tsgo), `bun run lint`, `bun test`, `cargo clippy`, `cargo test`. Do not run `tauri dev` or `tauri build`.

## Phases

1. **Scaffold.** Tauri 2, Vite, React, Tailwind using bun. A resizable three-pane shell with a terminal drawer, and a dark theme with tokens.
2. **Agent bridge (MVP core).** The Bun sidecar, the protocol package and the Rust relay. Chat with streaming, tool cards, an approval UI, interrupt, resume, and a model/effort picker.
3. **Live file panel (MVP).** "Follow agent" mode opens each `file.change` in the Monaco diff view. Also an edit timeline per turn, a file tree, manual edit and save, and the notify watcher for changes made outside the agent.
4. **Terminal.** portable-pty and ghostty-web, with multiple tabs.
5. **Code graph.** A tree-sitter import graph built in Rust, rendered with sigma.js. Nodes pulse on `file.read` and `file.change`; clicking a node opens the file; blast radius is a reverse-dependency BFS.
6. **Polish.** Git hidden-ref checkpoints and per-turn rollback, SQLite thread persistence, worktrees, and EXTREME-style motion (agent status sprites, frame glow).

Phases 1–3 make up the MVP. Each phase ends with the checks passing and tests added for the protocol, the graph builder and the diff capture.
