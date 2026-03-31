# timberborn-automation

An MCP channel server that monitors [Timberborn](https://timberborn.io/) settlements via the game's [HTTP API](https://timberborn.wiki.gg/wiki/HTTP_API), stores complete state history, and lets Claude make decisions about your beaver colonies in real-time.

## How it works

Timberborn 1.0 introduced [HTTP Levers](https://timberborn.wiki.gg/wiki/HTTP_Lever) and [HTTP Adapters](https://timberborn.wiki.gg/wiki/HTTP_Adapter) — in-game buildings that expose automation signals over a local REST API. This sidecar connects to that API and acts as Claude's eyes, hands, and memory:

- **Polls** adapters and levers every few seconds, recording all state changes to SQLite
- **Pushes** real-time notifications to Claude when things happen (new devices, state changes, connection issues)
- **Exposes MCP tools** so Claude can query device state, browse history, control levers, and register watchers
- **Receives webhooks** from Timberborn HTTP Adapters for instant state updates

Claude sees the full picture — trends, rates of change, drought patterns — and can flip levers to react. You play the game and build the infrastructure; Claude manages the automation.

## Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Claude Code](https://claude.ai/code) v2.1.80+
- Timberborn with HTTP Lever/Adapter buildings researched (5000 SP / 7500 SP)

## Setup

```bash
git clone https://github.com/fank/timberborn-automation.git
cd timberborn-automation
bun install
```

### Create a project for your savegame

```bash
mkdir -p projects/my-savegame
cp projects/example/{config.yaml,CLAUDE.md} projects/my-savegame/
```

Add a `.mcp.json` inside the project directory so Claude Code picks up the channel when you work from there:

```json
{
  "mcpServers": {
    "timberborn": {
      "command": "bun",
      "args": ["../../src/server.ts", "--project", "."]
    }
  }
}
```

Then start Claude Code from the project directory (required during research preview):

```bash
cd projects/my-savegame
claude --dangerously-load-development-channels server:timberborn
```

The `history.db` and config live alongside your session — each savegame is a self-contained workspace.

## MCP Tools

Once connected, Claude has these tools available:

| Tool | Description |
|------|-------------|
| `list_devices` | List all known adapters and levers (filterable by type/group) |
| `get_device` | Get a single device's current state and metadata |
| `annotate_device` | Label a device and assign it to a group |
| `query_history` | Browse state change history with time range and limit filters |
| `switch_lever` | Switch a lever on/off or set its color |
| `create_watcher` | Register a condition that triggers a notification |
| `list_watchers` | List all active watchers |
| `delete_watcher` | Remove a watcher |
| `get_status` | Sidecar health, connectivity, and device counts |

## Watchers

Watchers let Claude register conditions that push notifications automatically:

| Condition | Triggers when |
|-----------|---------------|
| `state_changed` | Any state transition |
| `state_true` | Device goes true |
| `state_false` | Device goes false |
| `state_true_duration > 5m` | Device has been true for over 5 minutes |
| `state_false_duration > 10m` | Device has been false for over 10 minutes |
| `all_false` | All devices in a group are false |
| `any_false` | At least one device in a group is false |

## Channel Notifications

The sidecar pushes events directly into Claude's context as `<channel>` tags:

**System events** (always active):
- `device_discovered` — new adapter or lever appeared
- `device_disappeared` — device missing for 3+ consecutive polls
- `connection_lost` — Timberborn API unreachable
- `connection_restored` — API back online

**Watcher events** — triggered when a registered condition is met

## Example workflow

1. In Timberborn, research HTTP Lever (5000 SP) and HTTP Adapter (7500 SP)
2. Place adapters connected to Resource Counters at various thresholds (e.g., water > 50, water > 25)
3. Place levers connected to production buildings or floodgates
4. Start the sidecar — Claude automatically discovers all devices
5. Ask Claude to annotate and group the devices, set up watchers, and manage your settlement

## Configuration

All fields are optional with sensible defaults:

```yaml
timberborn:
  host: localhost    # Timberborn API host (default: localhost)
  port: 8080         # Timberborn API port (default: 8080)
poller:
  interval: 5s       # Poll frequency (default: 5s)
  webhook_port: 8081 # Port for receiving HTTP Adapter webhooks (default: 8081, matches Timberborn's default callback URL)
history:
  retention: 168h    # How long to keep state history (default: 168h / 7 days)
```

Duration values support: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

## Development

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
bun test test/store.test.ts  # Single file
```
