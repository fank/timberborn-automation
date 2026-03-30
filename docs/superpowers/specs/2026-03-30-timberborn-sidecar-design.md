# Timberborn Automation Sidecar — Design Spec

## Overview

A persistent sidecar service that monitors Timberborn settlements via the game's HTTP API (adapters/levers), stores complete state history, and pushes real-time notifications to Claude. Claude is the decision-making brain; the sidecar is the eyes, hands, and memory.

The sidecar runs as an **MCP channel server** spawned by Claude Code, communicating over stdio. It pushes events as channel notifications and exposes MCP tools for Claude to query state, control levers, and register watchers.

## Architecture

```
Timberborn (localhost:8080)
    ↕ polls adapters/levers + receives webhooks from HTTP Adapters
Sidecar (MCP channel over stdio, SQLite storage)
    ↕ MCP tools (Claude → sidecar) + channel notifications (sidecar → Claude)
Claude Code session
```

### Timberborn HTTP API (source of truth)

All data comes from Timberborn's built-in HTTP server:

**Levers (Claude controls):**
- `GET /api/levers` → `[{name: string, state: boolean, springReturn: boolean}]`
- `GET /api/levers/:name` → `{name, state, springReturn}`
- `GET /api/switch-on/:name`
- `GET /api/switch-off/:name`
- `GET /api/color/:name/:hex`

**Adapters (game state):**
- `GET /api/adapters` → `[{name: string, state: boolean}]`
- `GET /api/adapters/:name` → `{name, state}`

Port is configurable (default 8080, alternative range 50000-65000). API is case-sensitive. Names must be URL-encoded.

Both adapters and levers expose **boolean state only**. Numeric values (water levels, resource counts) are represented as threshold-based boolean chains in-game (e.g., Resource Counter at threshold 50 → HTTP Adapter = "water above 50").

### Runtime

- **Language:** TypeScript
- **Runtime:** Bun
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** SQLite via `bun:sqlite`
- **Transport:** stdio (spawned by Claude Code as subprocess)

## Data Model — 5 Tables

All tables live in a single SQLite database per project (savegame). No project or settlement columns — the DB file provides isolation.

### 1. `devices`

Unified registry of all adapters and levers. Auto-populated by the poller when devices are discovered. Claude enriches with label/group via the `annotate_device` tool.

| Column | Type | Notes |
|--------|------|-------|
| `name` | TEXT PK | From Timberborn API |
| `type` | TEXT NOT NULL | `adapter` or `lever` |
| `first_seen` | TEXT NOT NULL | ISO 8601 datetime |
| `last_seen` | TEXT NOT NULL | ISO 8601 datetime |
| `current_state` | INTEGER NOT NULL | 0 or 1 |
| `spring_return` | INTEGER | Levers only, nullable |
| `label` | TEXT | Claude's annotation, nullable |
| `group_name` | TEXT | Claude's grouping, nullable |

### 2. `state_changes`

Every state transition for every device. This is the core time-series memory.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `device_name` | TEXT NOT NULL | FK → devices.name |
| `timestamp` | TEXT NOT NULL | ISO 8601 datetime |
| `state` | INTEGER NOT NULL | 0 or 1 |
| `source` | TEXT NOT NULL | `poll` or `webhook` |

Indexed on `(device_name, timestamp)`.

### 3. `commands`

Audit log of every lever action Claude sent.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `lever_name` | TEXT NOT NULL | |
| `timestamp` | TEXT NOT NULL | ISO 8601 datetime |
| `action` | TEXT NOT NULL | `switch-on`, `switch-off`, `color` |
| `value` | TEXT | Hex color for color action, null otherwise |
| `success` | INTEGER NOT NULL | 0 or 1 |

### 4. `watchers`

Conditions Claude registers. When a condition fires, the sidecar pushes a channel notification and logs to the events table.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Claude-chosen ID |
| `device_name` | TEXT | Specific device, nullable |
| `group_name` | TEXT | Watch whole group, nullable |
| `condition` | TEXT NOT NULL | e.g. `state_changed`, `state_false`, `state_false_duration > 5m`, `all_false`, `any_false` |
| `active` | INTEGER NOT NULL | 0 or 1 |
| `created_at` | TEXT NOT NULL | ISO 8601 datetime |

### 5. `events`

Historical log of all events (system + watcher). Notifications are pushed to Claude via channel; this table is the audit log.

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `watcher_id` | TEXT | Null for system events |
| `type` | TEXT NOT NULL | `watcher`, `device_discovered`, `device_disappeared`, `connection_lost`, `connection_restored` |
| `device_name` | TEXT | Which device, if relevant |
| `timestamp` | TEXT NOT NULL | ISO 8601 datetime |
| `message` | TEXT NOT NULL | Human-readable description |

## MCP Tools

Claude calls these natively (no curl). All return JSON.

### Device Management

| Tool | Input | Description |
|------|-------|-------------|
| `list_devices` | `{type?, group?}` | All known devices, filterable |
| `get_device` | `{name}` | Single device with current state + metadata |
| `annotate_device` | `{name, label?, group?}` | Set label/group on a device |

### History

| Tool | Input | Description |
|------|-------|-------------|
| `query_history` | `{name?, group?, since?, until?, limit?}` | State change history, filterable |

### Lever Control

| Tool | Input | Description |
|------|-------|-------------|
| `switch_lever` | `{name, action: "on"\|"off"\|"color", value?}` | Proxied to Timberborn, logged in commands table |

### Watchers

| Tool | Input | Description |
|------|-------|-------------|
| `create_watcher` | `{id, device_name?, group_name?, condition}` | Register a condition |
| `list_watchers` | `{}` | All watchers |
| `delete_watcher` | `{id}` | Remove a watcher |

### System

| Tool | Input | Description |
|------|-------|-------------|
| `get_status` | `{}` | Sidecar health, Timberborn connectivity, last poll time, device counts |

## Channel Notifications (Push → Claude)

All arrive as `<channel source="timberborn" ...>` tags in Claude's context.

### Built-in System Events (always active)

| Type | When | Example |
|------|------|---------|
| `device_discovered` | Poller finds a new device | `<channel source="timberborn" type="device_discovered" device="HTTP Adapter 3">New adapter detected: HTTP Adapter 3</channel>` |
| `device_disappeared` | Device missing for 3+ consecutive polls | `<channel source="timberborn" type="device_disappeared" device="HTTP Lever 2">Device no longer detected: HTTP Lever 2</channel>` |
| `connection_lost` | Timberborn API unreachable | `<channel source="timberborn" type="connection_lost">Cannot reach Timberborn at localhost:8080</channel>` |
| `connection_restored` | Timberborn API back online | `<channel source="timberborn" type="connection_restored">Timberborn connection restored</channel>` |

### Watcher Events (Claude-registered)

Fired when a registered watcher's condition is met:

```
<channel source="timberborn" type="watcher" watcher_id="water-low" device="WaterBelow50">
Watcher triggered: WaterBelow50 went false (was true for 12m30s)
</channel>
```

### Watcher Conditions

| Condition | Meaning |
|-----------|---------|
| `state_changed` | Any state transition (true→false or false→true) |
| `state_true` | Device state became true |
| `state_false` | Device state became false |
| `state_false_duration > Xm` | Device has been false for longer than X minutes |
| `state_true_duration > Xm` | Device has been true for longer than X minutes |
| `all_false(group)` | Every device in the group is false |
| `any_false(group)` | At least one device in the group is false |

## Poller Behavior

1. Every `interval` (default 5s), call `GET /api/adapters` and `GET /api/levers` on Timberborn
2. For each device in the response:
   - If new → insert into `devices`, fire `device_discovered` notification
   - If state changed → insert into `state_changes`, update `current_state`, evaluate watchers
   - Update `last_seen`
3. For any previously known device NOT in the response:
   - If missing for > 3 consecutive polls → fire `device_disappeared` notification
4. If Timberborn is unreachable → fire `connection_lost` (once)
5. When it comes back → fire `connection_restored`

## Webhook Receiver

The sidecar also listens on a configurable HTTP port for pushes from Timberborn HTTP Adapters. Same state-change logic as the poller but with `source=webhook`. Catches brief signal pulses that polling might miss.

## Project Structure

```
timberborn-automation/
├── src/
│   ├── server.ts              # MCP channel server entry point
│   ├── poller.ts              # Polls Timberborn adapters/levers
│   ├── store.ts               # SQLite repository layer
│   ├── timberborn.ts          # Timberborn HTTP API client
│   ├── watcher.ts             # Condition engine
│   ├── webhook.ts             # Receives pushes from Timberborn adapters
│   └── tools/                 # MCP tool handlers
│       ├── devices.ts
│       ├── history.ts
│       ├── levers.ts
│       ├── watchers.ts
│       └── status.ts
├── projects/
│   └── my-first-savegame/
│       ├── config.yaml
│       └── history.db
├── package.json
├── tsconfig.json
└── bun.lock
```

## Configuration

Per-project `config.yaml`:

```yaml
timberborn:
  host: localhost
  port: 8080
poller:
  interval: 5s
  webhook_port: 9090
history:
  retention: 168h  # 7 days
```

## MCP Registration

In `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "timberborn": {
      "command": "bun",
      "args": ["./src/server.ts", "--project", "projects/my-first-savegame"]
    }
  }
}
```

Launch with `--dangerously-load-development-channels server:timberborn` during research preview.

## History Retention

A background job prunes `state_changes`, `commands`, and `events` older than `history.retention`. The `devices` table is never pruned.
