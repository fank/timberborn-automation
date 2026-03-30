# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run start -- --project ./projects/example   # Run the MCP server
bun test                                         # Run all tests
bun test test/store.test.ts                      # Run a single test file
bun test --watch                                 # Watch mode
```

## Bun Runtime

Use Bun exclusively — no Node.js, npm, or third-party equivalents:
- `bun:sqlite` for SQLite (not better-sqlite3)
- `Bun.serve()` for HTTP servers (not express)
- `Bun.file` over `node:fs` readFile/writeFile
- `bun test` with `import { test, expect } from "bun:test"`
- Bun auto-loads `.env` — no dotenv

## Architecture

This is an **MCP (Model Context Protocol) channel server** that acts as a sidecar for the Timberborn game's HTTP Adapter mod. It polls the game for device state, evaluates user-defined watchers, and pushes notifications to Claude via MCP channel events.

### Data Flow

```
Timberborn HTTP API ──→ Poller ──→ Store (SQLite)
                    ──→ Webhook ──→ Store (SQLite)
                         │              ↑
                         ├──→ Notifier ──→ MCP channel
                         │
                    MCP tool calls (from Claude)
```

### Core Modules (`src/`)

- **`server.ts`** — Entry point. Wires MCP server, tool handlers, poller loop, webhook server, and prune loop. Requires `--project <path>` pointing to a directory with `config.yaml`.
- **`config.ts`** — Loads `config.yaml` (YAML) with duration parsing (`5s`, `10m`, `168h`). Defaults: host=localhost, port=8080, poll=5s, webhook=9090, retention=7d.
- **`store.ts`** — SQLite persistence via `bun:sqlite`. Five tables: `devices`, `state_changes`, `commands`, `watchers`, `events`. Auto-migrates on construction. Uses `:memory:` in tests.
- **`timberborn.ts`** — HTTP client for the game's REST API (`/api/adapters`, `/api/levers`, `/api/switch-on/:name`, etc.).
- **`poller.ts`** — `pollOnce()` compares game state against store, emits system events (device_discovered, device_disappeared, connection_lost/restored), and triggers watchers on state changes.
- **`watcher.ts`** — Condition engine. Instant conditions: `state_changed`, `state_true`, `state_false`, `all_false`, `any_false`. Duration conditions: `state_true_duration > Xm`, `state_false_duration > Xm`. Duration watchers are evaluated in the poll loop, not on state change.
- **`notifier.ts`** — Logs events to the store and pushes them as MCP `notifications/claude/channel` messages.
- **`webhook.ts`** — `Bun.serve()` on webhook port. Receives pushes from Timberborn HTTP Adapter at `/webhook/:adapterName`.

### Tool Handlers (`src/tools/`)

Each file exports handler functions called from `server.ts`'s `CallToolRequestSchema` switch. Most take `(store, args)`, but `switchLeverHandler` takes `(store, client, args)` and `getStatusHandler` takes `(store, pollerState)`. All return `{ content: [{ type: "text", text: JSON }] }`.

### Project Directories (`projects/`)

Each project directory contains a `config.yaml` and gets its own `history.db` at runtime. See `projects/example/` for the config format.
