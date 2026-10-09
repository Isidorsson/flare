# Flare: plan

A Windows-first Tauri 2 desktop app that drives the user's installed Claude Code. The chat sits in the centre. A live file panel follows the agent's reads and edits, a code graph lights up as the agent moves through the project, and a terminal drawer runs underneath.

## Building blocks

- **Claude Agent SDK (TS)**: the only first-party programmatic driver. One long-lived `query()` fed by a message queue, `includePartialMessages`, `canUseTool` waiting on a UI decision, `resume`, `setModel()`, `interrupt()`, `effort`, `settings.outputStyle`, `initializationResult().available_output_styles`. There is no Rust SDK, so a TS sidecar hosts it.
- **ghostty-web** (MIT): a VT parser compiled to WASM with an xterm.js-compatible API, used for the terminal.
- **Live activity**: rather than replaying edits after they land on disk, Flare streams the Edit/Write tool input as the model writes it (`file.editing`) and settles with the exact before/after from `file.change`.

**Auth:** we spawn the user's own `claude` binary, which uses their existing login. That is fine for personal use. Anthropic does not allow *distributing* a product that offers claude.ai login, so a public release would need API-key auth instead.

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
│ checkpoints/ git snapshots per agent turn, undo / redo / roll back     │
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
  src/            React app (features: agent/, agent-wiring/, chat/, checkpoints/, files/, graph/, terminal/, threads/, right-panel/, shell/, workspace/)
  src-tauri/      Rust core (bridge/, pty/, proctree/, fs/, graph/, checkpoints/)
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
- [x] **Terminal profiles.** Rust detects shells (PowerShell, Windows PowerShell, cmd, Git Bash, WSL, Nushell; login shell plus bash/zsh/fish/nu on Unix) and Claude Code; the webview launches by profile id, never by program path. Split "+" button opens the default shell, the chevron lists every profile with a pin to change the default (persisted). "Claude Code" runs the CLI in a tab, and the chat header's "Continue in Claude Code" forks the current session into it (`--resume <id> --fork-session`), which Flare's graph, checkpoints and cost do not track.
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

### Checkpoints (done 2026-10-06)
- [x] A snapshot of the working tree when a turn starts and ends, stored as parentless commits under `refs/flare/checkpoints/<thread id>/<turn>/start|end`. Taken with `git add -A` into a scratch copy of the index plus `write-tree` and `commit-tree`, so the user's index, HEAD, branches, stash and files are never touched; `.gitignore` is honoured. A folder outside any repository gets a private bare repository under the app data dir (refused above 20,000 files). Snapshots go through git's own line-ending rules in a repository and are byte-exact in a private one.
- [x] "Undo turn" (turn footer, files turn strip) puts back only the files that turn changed, after a confirm step that lists them and flags files edited since. "Roll back to before this turn" (checkpoints menu in the chat header) also undoes later turns. Every restore saves a safety checkpoint first, so the toast offers Redo. Kept: the last 50 turns per thread; threads quiet for 14 days are deleted on startup (private repos) and when a workspace opens.
- [x] The start snapshot is taken when a message is sent (the thread turns "running"), not on `turn.started`, which arrives only once the model streams and so can come after the agent's first edit; `turn.started` is the fallback for turns nobody sent a message for. The remaining gap is a first tool call that outruns a snapshot of a very large repository; closing it needs the bridge to wait for an acknowledgement in its PreToolUse hook.
- [ ] Follow-ups: mark undone turns in the transcript, per-file undo, a persistent list after restart (waits for thread persistence).

### Git workflow (done 2026-10-09)
Stage, commit, branch, pull and push from a **Changes** tab in the right panel (Files | Graph | Split | Changes), with commit messages generated by Claude on request. Unlike checkpoints, this deliberately drives the user's own index, HEAD and branches, but only on an explicit click.

**Rust `vcs/`** (shares the `git` runner with `checkpoints/`, moved to `src-tauri/src/git_cli.rs`). Every command takes `{ root }` plus the fields listed, runs off the async runtime, sets `GIT_TERMINAL_PROMPT=0` (push/pull fail instead of hanging on a prompt), and returns errors as `{ code, message }` like checkpoints. Mutating commands return the fresh `VcsStatus`.
- `vcs_status` → `VcsStatus { isRepo, branch: string | null (null = detached), head: string | null (short sha), upstream: string | null, ahead, behind, files: VcsFile[] }`; `VcsFile { path, origPath: string | null, staged: Change | null, unstaged: Change | null }`; `Change = "added" | "modified" | "deleted" | "renamed" | "typeChanged" | "untracked" | "conflicted"`. A folder outside a repository returns `isRepo: false` and empty fields, never an error. Parsed from `git status --porcelain=v2 -z --branch`.
- `vcs_file_diff { path, staged }` → `{ path, original: string | null, modified: string | null, binary }`: the two texts for the Monaco diff (staged: HEAD vs index; unstaged: index vs working tree). `null` means the side does not exist.
- `vcs_stage { paths }`, `vcs_unstage { paths }` (empty `paths` = everything), `vcs_discard { paths }` (tracked files only, back to the index; the UI confirms first).
- `vcs_commit { message }` → `{ commit, summary, status }`; message passed on stdin (`git commit -F -`). Refuses an empty message or nothing staged.
- `vcs_branches` → `VcsBranch[] { name, remote: boolean, current, upstream: string | null }`.
- `vcs_branch_create { name }` (create from HEAD and switch), `vcs_switch { name }` (a remote branch `origin/x` switches to a tracking `x`; refuses when local changes would be overwritten), `vcs_branch_delete { name, force }`.
- `vcs_fetch`, `vcs_pull` (`--ff-only`), `vcs_push` (adds `-u <remote> <branch>` when there is no upstream).
- `vcs_message_context` → `{ source: "staged" | "all", stat, patch, truncated, recentSubjects: string[] }`: the diff to describe (staged, or everything when nothing is staged) cut to `MESSAGE_PATCH_LIMIT` bytes with per-file caps, plus the last 10 commit subjects as a style hint.

**Bridge** (one-shot, independent of the chat session; no tools, one turn, model `COMMIT_MESSAGE_MODEL = "claude-haiku-5-5"` in `protocol/src/constants.ts`)
- App → bridge `commit.generate { requestId, stat, patch, truncated, recentSubjects, includeBody }`
- Bridge → app `commit.generated { requestId, subject, body: string | null }` and `commit.failed { requestId, message }`
- Subject follows Conventional Commits (`<type>(<scope>): <summary>`, ≤ 72 chars); body only when `includeBody`, wrapped at 72, explaining why.
- Frontend: `generateCommitMessage(input): Promise<{ subject, body }>` in `src/features/agent/commit-message.ts`, matching replies by `requestId`.

**UI** `src/features/vcs/`: master-detail. Left: branch picker (switch, create, delete), ahead/behind with Fetch/Pull/Push, Staged and Changes lists with per-file and all stage/unstage/discard. Right: Monaco diff of the selected file. Bottom: subject, optional description, "Generate" (sparkle; "with description" toggle), Commit and Commit & Push. Status refreshes on fs watcher events and after every action.

- [x] Phase A: Rust `vcs/` + `git_cli` move. Paths are repo-top-relative; empty `paths` on discard is refused; writes queue per repo.
- [x] Phase B: protocol + bridge generator + `commit-message.ts`.
- [x] Phase C: Changes tab UI, generator wired in `main.tsx` via `configureVcs`.
- [ ] Unverified: live Haiku generation, push/pull against HTTPS/SSH remotes (a credential manager window can block up to the 10 min network timeout), panel layout in the running app.
- [ ] Later: hunk/line staging, amend, stash.

#### Pull requests and richer commit context (in progress)
**Commit context upgrade.** `vcs_message_context` also returns `branch: string | null` and `recentBodies: string[]` (bodies of the last 3 commits that have one, newest first, each trimmed and capped at `RECENT_BODY_LIMIT` chars). `commit.generate` gains the same two fields; the prompt uses the branch name as a hint for type and scope (`feat/login` → `feat(login)`) and the bodies as the style to follow for descriptions.

**Rust** (in `vcs/`, via the `gh` CLI run through `git_cli`-style runner: no shell, `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, network timeout). Same `{ request: { root, ... } }` shape and `{ code, message }` errors; new codes `gh_missing`, `gh_unauthenticated`, `no_commits` (branch has nothing ahead of base), `on_base_branch`.
- `vcs_pr_info` → `PrInfo { ghAvailable, authenticated, defaultBase: string | null, current: PullRequest | null }`; `PullRequest { number, url, title, state: "open" | "closed" | "merged", isDraft, base }`. Missing or signed-out `gh` is reported in the fields, never as an error. `current` is the PR whose head is the current branch (`gh pr view --json`), null when none or detached.
- `vcs_pr_context { base }` → `{ base, branch, commits: { subject, body }[] (oldest first, capped at 50), stat, truncated }`: commits in `base..HEAD` (merge-base against `origin/<base>` when it exists, else local `<base>`) and `git diff --stat` over the same range.
- `vcs_pr_create { title, body, base, draft }` → `{ pr: PullRequest, status: VcsStatus }`: pushes first when the branch has no upstream or is ahead, then `gh pr create --title <t> --body-file - --base <b> --head <branch>` (`--draft` when asked), body on stdin. Refuses an empty title, a detached HEAD and creating from the base branch itself.

**Bridge**: `pr.generate { requestId, branch, base, commits, stat, truncated }` → `pr.generated { requestId, title, body }` / `pr.failed { requestId, message }`. Same one-shot Haiku generator as commits. Title ≤ 72 chars (Conventional Commits style when the commits use it); body Markdown with `## Summary` (bullets), `## Why`, and `## Test plan` only when tests are touched; no AI attribution. Frontend `generatePullRequest(input): Promise<{ title, body }>` in `src/features/agent/pr-message.ts`.

**UI**: a collapsible "Pull request" section in the Changes tab, below the commit box. Hidden on the default base branch and detached HEAD. If `gh` is missing or signed out it explains the fix (`winget install GitHub.cli`, `gh auth login`). If `current` exists it shows `#N title`, state and Open in browser (`tauri-plugin-opener`). Otherwise: base picker (default `defaultBase`), title, body, Generate (sparkles), Draft toggle, Create PR. Generator injected through `configureVcs({ generateMessage, generatePullRequest })`. Commit generation passes `branch` and `recentBodies` through.

- [ ] Phase D: Rust (context upgrade + `vcs_pr_*`).
- [ ] Phase E: protocol + bridge (`commit.generate` new fields, `pr.generate`) + `pr-message.ts`.
- [ ] Phase F: UI (pull request section, pass-through of new commit fields).

### Next
- [ ] **6. Polish (original plan).**
  - SQLite thread persistence (threads and transcripts survive restarts).
  - Worktrees: run a thread in its own git worktree.
  - Motion polish: agent status sprites, frame glow while working.
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

### Backlog
- [ ] **Session sidebar.** Sessions grouped by project, per-agent cards (agent, branch, task, status: Working / Needs permission / Idle, last action, `+A −R`), multiple agents per project, usage bars (5 h / week) at the bottom.
- [ ] **Backend architecture view.** Columns Frontend → Compute → Data → Services as cards (framework, deploy target, bindings, status chips like "Deployed", "Newer commits than the last deploy", "1 migration not applied") with connecting lines; inspector with environments, overview, deployments, out-of-sync warnings, where each binding is used in code.
- [ ] **Database view.** Live schema diagram: tables with columns, types, keys, relation lines; inspector with columns, references, "used in code".
- [ ] **Visual Fix.** Built-in browser pane on the dev server (localhost port picker, device sizes); "Pick" mode: hover any element in the app and click to ask Claude to fix it.
- [ ] **Background process manager.** Everything left running (VMs, containers, agent sessions, browser automation, log followers) with last-used time, memory, "Ready to close" status, Stop/Close buttons and "Close N ready to close"; views Needs attention | Everything | By project. Extends the Job Object work in `proctree/`.
- [ ] **Multiple agents at once.** Editor grid with one pane per active agent, per-agent comet colours, same-file conflict warning.
- [ ] **Review inbox.** Turn-start snapshot (temporary git index + write-tree), per-file accept/undo, line comments, send feedback to the agent, commit/PR.
