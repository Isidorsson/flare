# Flare

A Windows-first desktop app that drives your installed [Claude Code](https://docs.anthropic.com/en/docs/claude-code). The chat sits in the centre; a live file view follows the agent's reads and edits as they stream, a code graph lights up where the agent works, and a terminal drawer runs underneath.

Built with Tauri 2, React 19, Tailwind v4 and a Bun sidecar using the Claude Agent SDK.

## Features

- **Chat** with streaming markdown, tool cards, approvals, interrupt and resume; model › effort menu, permission modes and Claude Code output styles.
- **Live file view**: reads highlighted with "Claude · reading lines a–b", edits typed in as the model writes them, removed-line ghosts, per-turn marks and a turn summary strip.
- **Code graph**: tree-sitter import graph for 20+ languages (TS/JS, Rust, Python, Lua/Luau, Go, C/C++, C#, Java, Kotlin, Ruby, PHP, Dart, Zig, shell, CSS, Vue, Svelte…), folder overview, blast radius, and an agent comet that follows reads and edits.
- **Checkpoints**: every agent turn is snapshotted to hidden git refs; undo a turn, roll back further, redo. Your index, HEAD, branches and stash are never touched.
- **Terminal**: ConPTY + [ghostty-web](https://github.com/coder/ghostty-web) tabs. Every process Flare starts runs in a Windows Job Object, so nothing outlives the app.

## Requirements

- Windows 10/11 with WebView2
- [Bun](https://bun.sh) and a Rust toolchain (MSVC)
- Claude Code installed and logged in (`claude` on `PATH`, or set `FLARE_CLAUDE_PATH`)

## Run

```bash
bun install
bun run tauri dev
```

In development the agent bridge runs from source with Bun. For a release build, `bun run tauri build` compiles the bridge sidecar first.

## Checks

```bash
bun run typecheck
bun run lint
bun test
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Note on authentication

Flare spawns your own `claude` binary, so it uses your existing Claude Code login. That is intended for personal use. Distributing a product that signs users in with claude.ai is not permitted; a public distribution would need API-key authentication instead.

## Project layout

```
src/          React app, split by feature (chat, files, graph, terminal, checkpoints, …)
src-tauri/    Rust core: bridge relay, PTY, process trees, filesystem, graph indexer, checkpoints
bridge/       Bun sidecar wrapping the Claude Agent SDK
protocol/     zod schemas shared by the bridge and the app
```

See [PLAN.md](PLAN.md) for the architecture, protocol and roadmap.

## License

[MIT](LICENSE)
