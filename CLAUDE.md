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
                         ├──→ Rule Engine ──→ Lever switches (autonomous)
                         │
                    MCP tool calls (from Claude)
```

### Core Modules (`src/`)

- **`server.ts`** — Entry point. Wires MCP server, tool handlers, poller loop, webhook server, and prune loop. Requires `--project <path>` pointing to a directory with `config.yaml`.
- **`config.ts`** — Loads `config.yaml` (YAML) with duration parsing (`5s`, `10m`, `168h`). Defaults: host=localhost, port=8080, poll=5s, webhook=9090, retention=7d.
- **`store.ts`** — SQLite persistence via `bun:sqlite`. Seven tables: `devices`, `state_changes`, `commands`, `watchers`, `events`, `rules`, `rule_executions`. Auto-migrates on construction. Uses `:memory:` in tests.
- **`timberborn.ts`** — HTTP client for the game's REST API (`/api/adapters`, `/api/levers`, `/api/switch-on/:name`, etc.).
- **`poller.ts`** — `pollOnce()` compares game state against store, emits system events (device_discovered, device_disappeared, connection_lost/restored), triggers watchers on state changes, and invokes the rule engine via optional `onStateChange` callback.
- **`watcher.ts`** — Condition engine for watchers (notify-only). Instant conditions: `state_changed`, `state_true`, `state_false`, `all_false`, `any_false`. Duration conditions: `state_true_duration > Xm`, `state_false_duration > Xm`. Duration watchers are evaluated in the poll loop, not on state change.
- **`rule-types.ts`** — Type definitions for the automation rules engine: `Condition` (device, not, and, or, duration, group_all, group_any), `Action` (switch, notify, enable_group, disable_group, sequence), `Rule`, `RuleRow`, `RuleExecutionRow`.
- **`rule-engine.ts`** — Automation rule engine. `evaluateCondition()` evaluates nested boolean condition trees against store state. `RuleEngine` class handles edge-triggered rules (fire once on false→true condition transition). Includes cooldown tracking, lever resync on startup, action execution (lever switching, notifications, group enable/disable), and duration-based rule evaluation.
- **`notifier.ts`** — Logs events to the store and pushes them as MCP `notifications/claude/channel` messages.
- **`webhook.ts`** — `Bun.serve()` on webhook port. Receives pushes from Timberborn HTTP Adapter at `/webhook/:adapterName`. Triggers both watchers and rules on state changes.

### Tool Handlers (`src/tools/`)

Each file exports handler functions called from `server.ts`'s `CallToolRequestSchema` switch. Most take `(store, args)`, but `switchLeverHandler` takes `(store, client, args)` and `getStatusHandler` takes `(store, pollerState)`. All return `{ content: [{ type: "text", text: JSON }] }`.

### Project Directories (`projects/`)

Each project directory contains a `config.yaml` and gets its own `history.db` at runtime. See `projects/example/` for the config format.
