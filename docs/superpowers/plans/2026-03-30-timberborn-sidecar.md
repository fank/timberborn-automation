# Timberborn Automation Sidecar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP channel server that monitors Timberborn settlements, stores state history in SQLite, exposes tools for Claude to query/control the game, and pushes real-time notifications when events occur.

**Architecture:** TypeScript MCP channel server over stdio, spawned by Claude Code. Polls Timberborn's HTTP API for adapter/lever state, stores transitions in SQLite, evaluates watcher conditions, and pushes channel notifications. Also listens on an HTTP port for webhook pushes from Timberborn HTTP Adapters.

**Tech Stack:** TypeScript, Bun, `@modelcontextprotocol/sdk`, `bun:sqlite`, `yaml` (config parsing)

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Dependencies + scripts |
| `tsconfig.json` | TypeScript config |
| `src/config.ts` | Load + validate project config.yaml |
| `src/store.ts` | SQLite schema creation + all DB queries |
| `src/timberborn.ts` | HTTP client for Timberborn API |
| `src/notifier.ts` | Thin wrapper: logs event to DB + pushes MCP channel notification |
| `src/poller.ts` | Poll loop: fetch state, diff, record changes, fire events |
| `src/watcher.ts` | Evaluate watcher conditions against current state |
| `src/webhook.ts` | HTTP server receiving pushes from Timberborn HTTP Adapters |
| `src/tools/devices.ts` | list_devices, get_device, annotate_device tool handlers |
| `src/tools/history.ts` | query_history tool handler |
| `src/tools/levers.ts` | switch_lever tool handler |
| `src/tools/watchers.ts` | create_watcher, list_watchers, delete_watcher tool handlers |
| `src/tools/status.ts` | get_status tool handler |
| `src/server.ts` | MCP server entry point: wires everything together |
| `test/store.test.ts` | Store unit tests |
| `test/timberborn.test.ts` | Timberborn client tests (mocked HTTP) |
| `test/poller.test.ts` | Poller logic tests |
| `test/watcher.test.ts` | Watcher condition evaluation tests |
| `test/tools/*.test.ts` | Tool handler tests |

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `projects/.gitkeep`

- [ ] **Step 1: Initialize project**

```bash
cd /home/fank/repo/timberborn-automation
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add @modelcontextprotocol/sdk yaml
bun add -d @types/bun
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create projects directory with a sample config**

Create `projects/.gitkeep` (empty file) and `projects/example/config.yaml`:

```yaml
timberborn:
  host: localhost
  port: 8080
poller:
  interval: 5s
  webhook_port: 9090
history:
  retention: 168h
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock projects/
git commit -m "chore: initialize bun project with MCP SDK and yaml deps"
```

---

## Task 2: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
import { describe, it, expect } from "bun:test";
import { loadConfig, type Config } from "../src/config";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("loadConfig", () => {
  it("loads a valid config.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-test-"));
    writeFileSync(
      join(dir, "config.yaml"),
      `timberborn:
  host: localhost
  port: 8080
poller:
  interval: 5s
  webhook_port: 9090
history:
  retention: 168h
`
    );
    const cfg = loadConfig(dir);
    expect(cfg.timberborn.host).toBe("localhost");
    expect(cfg.timberborn.port).toBe(8080);
    expect(cfg.poller.intervalMs).toBe(5000);
    expect(cfg.poller.webhookPort).toBe(9090);
    expect(cfg.history.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(cfg.projectDir).toBe(dir);
  });

  it("uses defaults when fields are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-test-"));
    writeFileSync(join(dir, "config.yaml"), "");
    const cfg = loadConfig(dir);
    expect(cfg.timberborn.host).toBe("localhost");
    expect(cfg.timberborn.port).toBe(8080);
    expect(cfg.poller.intervalMs).toBe(5000);
    expect(cfg.poller.webhookPort).toBe(9090);
    expect(cfg.history.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config`

- [ ] **Step 3: Write the implementation**

```ts
// src/config.ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

export interface Config {
  projectDir: string;
  timberborn: {
    host: string;
    port: number;
  };
  poller: {
    intervalMs: number;
    webhookPort: number;
  };
  history: {
    retentionMs: number;
  };
}

function parseDuration(s: string | undefined, defaultMs: number): number {
  if (!s) return defaultMs;
  const match = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return defaultMs;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * (multipliers[unit] ?? 1);
}

export function loadConfig(projectDir: string): Config {
  const configPath = join(projectDir, "config.yaml");
  let raw: Record<string, any> = {};
  if (existsSync(configPath)) {
    const text = readFileSync(configPath, "utf-8");
    raw = parseYaml(text) ?? {};
  }

  return {
    projectDir,
    timberborn: {
      host: raw?.timberborn?.host ?? "localhost",
      port: raw?.timberborn?.port ?? 8080,
    },
    poller: {
      intervalMs: parseDuration(raw?.poller?.interval, 5000),
      webhookPort: raw?.poller?.webhook_port ?? 9090,
    },
    history: {
      retentionMs: parseDuration(raw?.history?.retention, 7 * 24 * 3_600_000),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add config loader with duration parsing and defaults"
```

---

## Task 3: SQLite Store

**Files:**
- Create: `src/store.ts`
- Create: `test/store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/store.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

describe("devices", () => {
  it("upserts and retrieves a device", () => {
    store.upsertDevice({
      name: "Lever 1",
      type: "lever",
      state: true,
      springReturn: false,
    });
    const dev = store.getDevice("Lever 1");
    expect(dev).not.toBeNull();
    expect(dev!.name).toBe("Lever 1");
    expect(dev!.type).toBe("lever");
    expect(dev!.currentState).toBe(1);
    expect(dev!.springReturn).toBe(0);
  });

  it("lists devices filtered by type", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({
      name: "L1",
      type: "lever",
      state: true,
      springReturn: true,
    });
    const adapters = store.listDevices({ type: "adapter" });
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe("A1");
  });

  it("lists devices filtered by group", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "water > 50", "water");
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    const water = store.listDevices({ group: "water" });
    expect(water).toHaveLength(1);
    expect(water[0].name).toBe("A1");
  });

  it("annotates a device with label and group", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "water > 50", "water");
    const dev = store.getDevice("A1");
    expect(dev!.label).toBe("water > 50");
    expect(dev!.groupName).toBe("water");
  });
});

describe("state_changes", () => {
  it("records a state change", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.recordStateChange("A1", true, "poll");
    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(1);
    expect(history[0].source).toBe("poll");
  });

  it("filters history by time range", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.recordStateChange("A1", true, "poll");
    const future = store.queryHistory({
      name: "A1",
      since: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(future).toHaveLength(0);
  });
});

describe("commands", () => {
  it("logs a lever command", () => {
    store.logCommand("L1", "switch-on", null, true);
    store.logCommand("L1", "color", "FF0000", true);
    const cmds = store.getCommands("L1");
    expect(cmds).toHaveLength(2);
    expect(cmds[1].action).toBe("color");
    expect(cmds[1].value).toBe("FF0000");
  });
});

describe("watchers", () => {
  it("creates and lists watchers", () => {
    store.createWatcher({
      id: "w1",
      deviceName: "A1",
      groupName: null,
      condition: "state_changed",
    });
    const list = store.listWatchers();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("w1");
    expect(list[0].active).toBe(1);
  });

  it("deletes a watcher", () => {
    store.createWatcher({
      id: "w1",
      deviceName: "A1",
      groupName: null,
      condition: "state_false",
    });
    store.deleteWatcher("w1");
    expect(store.listWatchers()).toHaveLength(0);
  });
});

describe("events", () => {
  it("logs an event", () => {
    store.logEvent({
      watcherId: null,
      type: "device_discovered",
      deviceName: "A1",
      message: "New adapter detected: A1",
    });
    const events = store.getRecentEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("device_discovered");
  });
});

describe("pruning", () => {
  it("prunes old state_changes", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    // Insert a state change with an old timestamp by direct SQL
    store.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source)
       VALUES ('A1', '2020-01-01T00:00:00.000Z', 0, 'poll')`
    );
    store.recordStateChange("A1", true, "poll");
    store.prune(1); // retain only 1ms
    const history = store.queryHistory({ name: "A1" });
    // only the recent one survives
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/store.test.ts`
Expected: FAIL — cannot resolve `../src/store`

- [ ] **Step 3: Write the implementation**

```ts
// src/store.ts
import { Database } from "bun:sqlite";

export interface DeviceRow {
  name: string;
  type: string;
  firstSeen: string;
  lastSeen: string;
  currentState: number;
  springReturn: number | null;
  label: string | null;
  groupName: string | null;
}

export interface StateChangeRow {
  id: number;
  deviceName: string;
  timestamp: string;
  state: number;
  source: string;
}

export interface CommandRow {
  id: number;
  leverName: string;
  timestamp: string;
  action: string;
  value: string | null;
  success: number;
}

export interface WatcherRow {
  id: string;
  deviceName: string | null;
  groupName: string | null;
  condition: string;
  active: number;
  createdAt: string;
}

export interface EventRow {
  id: number;
  watcherId: string | null;
  type: string;
  deviceName: string | null;
  timestamp: string;
  message: string;
}

export class Store {
  db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        current_state INTEGER NOT NULL,
        spring_return INTEGER,
        label TEXT,
        group_name TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS state_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        state INTEGER NOT NULL,
        source TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_state_changes_device_time
      ON state_changes (device_name, timestamp)
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lever_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        value TEXT,
        success INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchers (
        id TEXT PRIMARY KEY,
        device_name TEXT,
        group_name TEXT,
        condition TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watcher_id TEXT,
        type TEXT NOT NULL,
        device_name TEXT,
        timestamp TEXT NOT NULL,
        message TEXT NOT NULL
      )
    `);
  }

  upsertDevice(d: {
    name: string;
    type: string;
    state: boolean;
    springReturn?: boolean | null;
  }) {
    const now = new Date().toISOString();
    const existing = this.getDevice(d.name);
    if (!existing) {
      this.db.run(
        `INSERT INTO devices (name, type, first_seen, last_seen, current_state, spring_return)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          d.name,
          d.type,
          now,
          now,
          d.state ? 1 : 0,
          d.springReturn != null ? (d.springReturn ? 1 : 0) : null,
        ]
      );
    } else {
      this.db.run(
        `UPDATE devices SET last_seen = ?, current_state = ?, spring_return = ? WHERE name = ?`,
        [
          now,
          d.state ? 1 : 0,
          d.springReturn != null ? (d.springReturn ? 1 : 0) : null,
          d.name,
        ]
      );
    }
  }

  getDevice(name: string): DeviceRow | null {
    return (
      this.db
        .query<DeviceRow, [string]>(
          `SELECT name, type, first_seen AS firstSeen, last_seen AS lastSeen,
                current_state AS currentState, spring_return AS springReturn,
                label, group_name AS groupName
         FROM devices WHERE name = ?`
        )
        .get(name) ?? null
    );
  }

  listDevices(filter?: { type?: string; group?: string }): DeviceRow[] {
    let sql = `SELECT name, type, first_seen AS firstSeen, last_seen AS lastSeen,
                      current_state AS currentState, spring_return AS springReturn,
                      label, group_name AS groupName FROM devices WHERE 1=1`;
    const params: string[] = [];
    if (filter?.type) {
      sql += " AND type = ?";
      params.push(filter.type);
    }
    if (filter?.group) {
      sql += " AND group_name = ?";
      params.push(filter.group);
    }
    return this.db.query<DeviceRow, string[]>(sql).all(...params);
  }

  annotateDevice(
    name: string,
    label: string | null,
    groupName: string | null
  ) {
    this.db.run(`UPDATE devices SET label = ?, group_name = ? WHERE name = ?`, [
      label,
      groupName,
      name,
    ]);
  }

  recordStateChange(
    deviceName: string,
    state: boolean,
    source: string
  ) {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source)
       VALUES (?, ?, ?, ?)`,
      [deviceName, now, state ? 1 : 0, source]
    );
    this.db.run(
      `UPDATE devices SET current_state = ?, last_seen = ? WHERE name = ?`,
      [state ? 1 : 0, now, deviceName]
    );
  }

  queryHistory(filter: {
    name?: string;
    group?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): StateChangeRow[] {
    let sql = `SELECT sc.id, sc.device_name AS deviceName, sc.timestamp,
                      sc.state, sc.source
               FROM state_changes sc`;
    const params: (string | number)[] = [];
    if (filter.group) {
      sql += " JOIN devices d ON sc.device_name = d.name";
    }
    sql += " WHERE 1=1";
    if (filter.name) {
      sql += " AND sc.device_name = ?";
      params.push(filter.name);
    }
    if (filter.group) {
      sql += " AND d.group_name = ?";
      params.push(filter.group);
    }
    if (filter.since) {
      sql += " AND sc.timestamp >= ?";
      params.push(filter.since);
    }
    if (filter.until) {
      sql += " AND sc.timestamp <= ?";
      params.push(filter.until);
    }
    sql += " ORDER BY sc.timestamp DESC";
    if (filter.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }
    return this.db
      .query<StateChangeRow, (string | number)[]>(sql)
      .all(...params);
  }

  logCommand(
    leverName: string,
    action: string,
    value: string | null,
    success: boolean
  ) {
    this.db.run(
      `INSERT INTO commands (lever_name, timestamp, action, value, success)
       VALUES (?, ?, ?, ?, ?)`,
      [leverName, new Date().toISOString(), action, value, success ? 1 : 0]
    );
  }

  getCommands(leverName: string): CommandRow[] {
    return this.db
      .query<CommandRow, [string]>(
        `SELECT id, lever_name AS leverName, timestamp, action, value, success
         FROM commands WHERE lever_name = ? ORDER BY timestamp`
      )
      .all(leverName);
  }

  createWatcher(w: {
    id: string;
    deviceName: string | null;
    groupName: string | null;
    condition: string;
  }) {
    this.db.run(
      `INSERT INTO watchers (id, device_name, group_name, condition, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [w.id, w.deviceName, w.groupName, w.condition, new Date().toISOString()]
    );
  }

  listWatchers(): WatcherRow[] {
    return this.db
      .query<WatcherRow, []>(
        `SELECT id, device_name AS deviceName, group_name AS groupName,
                condition, active, created_at AS createdAt
         FROM watchers`
      )
      .all();
  }

  deleteWatcher(id: string) {
    this.db.run(`DELETE FROM watchers WHERE id = ?`, [id]);
  }

  getActiveWatchers(): WatcherRow[] {
    return this.db
      .query<WatcherRow, []>(
        `SELECT id, device_name AS deviceName, group_name AS groupName,
                condition, active, created_at AS createdAt
         FROM watchers WHERE active = 1`
      )
      .all();
  }

  logEvent(e: {
    watcherId: string | null;
    type: string;
    deviceName: string | null;
    message: string;
  }) {
    this.db.run(
      `INSERT INTO events (watcher_id, type, device_name, timestamp, message)
       VALUES (?, ?, ?, ?, ?)`,
      [e.watcherId, e.type, e.deviceName, new Date().toISOString(), e.message]
    );
  }

  getRecentEvents(limit: number): EventRow[] {
    return this.db
      .query<EventRow, [number]>(
        `SELECT id, watcher_id AS watcherId, type, device_name AS deviceName,
                timestamp, message
         FROM events ORDER BY timestamp DESC LIMIT ?`
      )
      .all(limit);
  }

  prune(retentionMs: number) {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    this.db.run(`DELETE FROM state_changes WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM commands WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM events WHERE timestamp < ?`, [cutoff]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/store.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.ts test/store.test.ts
git commit -m "feat: add SQLite store with all 5 tables, queries, and pruning"
```

---

## Task 4: Timberborn HTTP Client

**Files:**
- Create: `src/timberborn.ts`
- Create: `test/timberborn.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/timberborn.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TimberbornClient } from "../src/timberborn";

let server: ReturnType<typeof Bun.serve>;
let client: TimberbornClient;

const mockAdapters = [
  { name: "HTTP Adapter 1", state: true },
  { name: "HTTP Adapter 2", state: false },
];

const mockLevers = [
  { name: "HTTP Lever 1", state: true, springReturn: false },
];

beforeAll(() => {
  server = Bun.serve({
    port: 0, // random available port
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/adapters") {
        return Response.json(mockAdapters);
      }
      if (url.pathname === "/api/levers") {
        return Response.json(mockLevers);
      }
      if (url.pathname === "/api/switch-on/HTTP%20Lever%201") {
        return new Response("ok");
      }
      if (url.pathname === "/api/switch-off/HTTP%20Lever%201") {
        return new Response("ok");
      }
      if (url.pathname === "/api/color/HTTP%20Lever%201/FF0000") {
        return new Response("ok");
      }
      return new Response("not found", { status: 404 });
    },
  });
  client = new TimberbornClient("localhost", server.port);
});

afterAll(() => {
  server.stop();
});

describe("TimberbornClient", () => {
  it("fetches adapters", async () => {
    const adapters = await client.getAdapters();
    expect(adapters).toHaveLength(2);
    expect(adapters[0].name).toBe("HTTP Adapter 1");
    expect(adapters[0].state).toBe(true);
  });

  it("fetches levers", async () => {
    const levers = await client.getLevers();
    expect(levers).toHaveLength(1);
    expect(levers[0].springReturn).toBe(false);
  });

  it("switches a lever on", async () => {
    const ok = await client.switchOn("HTTP Lever 1");
    expect(ok).toBe(true);
  });

  it("switches a lever off", async () => {
    const ok = await client.switchOff("HTTP Lever 1");
    expect(ok).toBe(true);
  });

  it("sets lever color", async () => {
    const ok = await client.setColor("HTTP Lever 1", "FF0000");
    expect(ok).toBe(true);
  });

  it("reports unreachable server", async () => {
    const bad = new TimberbornClient("localhost", 1);
    const adapters = await bad.getAdapters();
    expect(adapters).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/timberborn.test.ts`
Expected: FAIL — cannot resolve `../src/timberborn`

- [ ] **Step 3: Write the implementation**

```ts
// src/timberborn.ts
export interface Adapter {
  name: string;
  state: boolean;
}

export interface Lever {
  name: string;
  state: boolean;
  springReturn: boolean;
}

export class TimberbornClient {
  private baseUrl: string;

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async getAdapters(): Promise<Adapter[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/adapters`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async getLevers(): Promise<Lever[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/levers`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async switchOn(name: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/switch-on/${encodeURIComponent(name)}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async switchOff(name: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/switch-off/${encodeURIComponent(name)}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async setColor(name: string, hex: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/color/${encodeURIComponent(name)}/${hex}`
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/timberborn.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/timberborn.ts test/timberborn.test.ts
git commit -m "feat: add Timberborn HTTP API client"
```

---

## Task 5: Notifier

**Files:**
- Create: `src/notifier.ts`

- [ ] **Step 1: Write the implementation**

The notifier is a thin wrapper that logs an event to the store and pushes an MCP channel notification. It depends on the MCP `Server` instance which we won't have in tests yet, so we define it as a class with injectable dependencies (no standalone test needed — tested via poller integration).

```ts
// src/notifier.ts
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Store } from "./store";

export class Notifier {
  constructor(
    private server: Server,
    private store: Store
  ) {}

  async notify(event: {
    watcherId?: string | null;
    type: string;
    deviceName?: string | null;
    message: string;
  }) {
    this.store.logEvent({
      watcherId: event.watcherId ?? null,
      type: event.type,
      deviceName: event.deviceName ?? null,
      message: event.message,
    });

    const meta: Record<string, string> = { type: event.type };
    if (event.deviceName) meta.device = event.deviceName;
    if (event.watcherId) meta.watcher_id = event.watcherId;

    await this.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: event.message,
        meta,
      },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/notifier.ts
git commit -m "feat: add notifier for event logging and channel push"
```

---

## Task 6: Watcher Engine

**Files:**
- Create: `src/watcher.ts`
- Create: `test/watcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/watcher.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { evaluateWatcher } from "../src/watcher";
import { Store } from "../src/store";

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

describe("evaluateWatcher", () => {
  it("state_changed triggers on any transition", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_changed", active: 1, createdAt: "" },
      "A1",
      true,
      false,
      store
    );
    expect(result).not.toBeNull();
    expect(result!.message).toContain("state changed");
  });

  it("state_false triggers when device goes false", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_false", active: 1, createdAt: "" },
      "A1",
      false,
      true,
      store
    );
    expect(result).not.toBeNull();
  });

  it("state_false does not trigger when device goes true", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_false", active: 1, createdAt: "" },
      "A1",
      true,
      false,
      store
    );
    expect(result).toBeNull();
  });

  it("state_true triggers when device goes true", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_true", active: 1, createdAt: "" },
      "A1",
      true,
      false,
      store
    );
    expect(result).not.toBeNull();
  });

  it("all_false triggers when all group devices are false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");

    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "all_false", active: 1, createdAt: "" },
      "A1",
      false,
      true,
      store
    );
    expect(result).not.toBeNull();
    expect(result!.message).toContain("all devices in group");
  });

  it("all_false does not trigger when one device is still true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");

    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "all_false", active: 1, createdAt: "" },
      "A1",
      false,
      true,
      store
    );
    expect(result).toBeNull();
  });

  it("any_false triggers when at least one device is false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");

    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "any_false", active: 1, createdAt: "" },
      "A1",
      false,
      true,
      store
    );
    expect(result).not.toBeNull();
  });

  it("ignores watchers for a different device", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A2", groupName: null, condition: "state_changed", active: 1, createdAt: "" },
      "A1",
      true,
      false,
      store
    );
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/watcher.test.ts`
Expected: FAIL — cannot resolve `../src/watcher`

- [ ] **Step 3: Write the implementation**

```ts
// src/watcher.ts
import type { WatcherRow, Store } from "./store";

export interface WatcherResult {
  watcherId: string;
  deviceName: string | null;
  message: string;
}

export function evaluateWatcher(
  watcher: WatcherRow,
  changedDevice: string,
  newState: boolean,
  previousState: boolean,
  store: Store
): WatcherResult | null {
  const cond = watcher.condition;

  // Device-specific watchers: only trigger for the matching device
  if (watcher.deviceName && watcher.deviceName !== changedDevice) {
    return null;
  }

  // Group watchers: only trigger if the changed device is in the group
  if (watcher.groupName && !watcher.deviceName) {
    const dev = store.getDevice(changedDevice);
    if (!dev || dev.groupName !== watcher.groupName) {
      return null;
    }
  }

  if (cond === "state_changed") {
    if (newState !== previousState) {
      return {
        watcherId: watcher.id,
        deviceName: changedDevice,
        message: `${changedDevice} state changed: ${previousState} → ${newState}`,
      };
    }
  }

  if (cond === "state_true" && newState === true && previousState === false) {
    return {
      watcherId: watcher.id,
      deviceName: changedDevice,
      message: `${changedDevice} went true`,
    };
  }

  if (cond === "state_false" && newState === false && previousState === true) {
    return {
      watcherId: watcher.id,
      deviceName: changedDevice,
      message: `${changedDevice} went false`,
    };
  }

  if (cond === "all_false" && watcher.groupName) {
    const devices = store.listDevices({ group: watcher.groupName });
    const allFalse = devices.every((d) => d.currentState === 0);
    if (allFalse) {
      return {
        watcherId: watcher.id,
        deviceName: changedDevice,
        message: `All devices in group '${watcher.groupName}' are now false`,
      };
    }
  }

  if (cond === "any_false" && watcher.groupName) {
    const devices = store.listDevices({ group: watcher.groupName });
    const anyFalse = devices.some((d) => d.currentState === 0);
    if (anyFalse) {
      return {
        watcherId: watcher.id,
        deviceName: changedDevice,
        message: `At least one device in group '${watcher.groupName}' is false`,
      };
    }
  }

  // Duration-based conditions (state_false_duration, state_true_duration)
  // are evaluated by the poller on a timer, not on state change events.
  // They are checked in evaluateDurationWatchers() below.

  return null;
}

export function evaluateDurationWatchers(
  store: Store
): WatcherResult[] {
  const results: WatcherResult[] = [];
  const watchers = store.getActiveWatchers();
  const now = Date.now();

  for (const w of watchers) {
    const durationMatch = w.condition.match(
      /^state_(true|false)_duration\s*>\s*(\d+)(m|h|s)$/
    );
    if (!durationMatch) continue;

    const targetState = durationMatch[1] === "true";
    const amount = parseInt(durationMatch[2], 10);
    const unit = durationMatch[3];
    const thresholdMs =
      amount * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);

    const deviceName = w.deviceName;
    if (!deviceName) continue;

    const device = store.getDevice(deviceName);
    if (!device) continue;

    const currentState = device.currentState === 1;
    if (currentState !== targetState) continue;

    // Find the most recent state change for this device
    const history = store.queryHistory({ name: deviceName, limit: 1 });
    if (history.length === 0) continue;

    const lastChangeTime = new Date(history[0].timestamp).getTime();
    const duration = now - lastChangeTime;

    if (duration >= thresholdMs) {
      const durationStr = formatDuration(duration);
      results.push({
        watcherId: w.id,
        deviceName,
        message: `${deviceName} has been ${targetState} for ${durationStr} (threshold: ${amount}${unit})`,
      });
    }
  }

  return results;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m${seconds % 60}s`;
  return `${seconds}s`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/watcher.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/watcher.ts test/watcher.test.ts
git commit -m "feat: add watcher condition evaluation engine"
```

---

## Task 7: Poller

**Files:**
- Create: `src/poller.ts`
- Create: `test/poller.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/poller.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { pollOnce } from "../src/poller";
import { Store } from "../src/store";
import type { Adapter, Lever } from "../src/timberborn";

let store: Store;
const events: { type: string; deviceName?: string | null; message: string }[] = [];

function mockNotify(e: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) {
  events.push(e);
  return Promise.resolve();
}

beforeEach(() => {
  store = new Store(":memory:");
  events.length = 0;
});

describe("pollOnce", () => {
  it("discovers new devices", async () => {
    const adapters: Adapter[] = [{ name: "A1", state: true }];
    const levers: Lever[] = [{ name: "L1", state: false, springReturn: true }];

    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce(adapters, levers, store, mockNotify, state);

    expect(store.getDevice("A1")).not.toBeNull();
    expect(store.getDevice("L1")).not.toBeNull();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("device_discovered");
    expect(events[1].type).toBe("device_discovered");
  });

  it("records state changes", async () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const state = { missedPolls: new Map<string, number>(), connected: true };

    await pollOnce(
      [{ name: "A1", state: false }],
      [],
      store,
      mockNotify,
      state
    );

    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(0);
  });

  it("fires device_disappeared after 3 missed polls", async () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const state = { missedPolls: new Map<string, number>(), connected: true };

    // 3 polls with A1 missing
    await pollOnce([], [], store, mockNotify, state);
    await pollOnce([], [], store, mockNotify, state);
    await pollOnce([], [], store, mockNotify, state);

    const disappeared = events.filter((e) => e.type === "device_disappeared");
    expect(disappeared).toHaveLength(1);
    expect(disappeared[0].deviceName).toBe("A1");
  });

  it("fires connection_lost when null is passed", async () => {
    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce(null, null, store, mockNotify, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("connection_lost");
    expect(state.connected).toBe(false);
  });

  it("fires connection_restored after reconnect", async () => {
    const state = { missedPolls: new Map<string, number>(), connected: false };
    await pollOnce([], [], store, mockNotify, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("connection_restored");
    expect(state.connected).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/poller.test.ts`
Expected: FAIL — cannot resolve `../src/poller`

- [ ] **Step 3: Write the implementation**

```ts
// src/poller.ts
import type { Store } from "./store";
import type { Adapter, Lever } from "./timberborn";
import { evaluateWatcher } from "./watcher";

export interface PollerState {
  missedPolls: Map<string, number>;
  connected: boolean;
}

type NotifyFn = (event: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) => Promise<void>;

export async function pollOnce(
  adapters: Adapter[] | null,
  levers: Lever[] | null,
  store: Store,
  notify: NotifyFn,
  state: PollerState
) {
  // Connection lost
  if (adapters === null || levers === null) {
    if (state.connected) {
      state.connected = false;
      await notify({
        type: "connection_lost",
        message: "Cannot reach Timberborn API",
      });
    }
    return;
  }

  // Connection restored
  if (!state.connected) {
    state.connected = true;
    await notify({
      type: "connection_restored",
      message: "Timberborn connection restored",
    });
  }

  // Build set of all device names seen this poll
  const seenNames = new Set<string>();

  // Process adapters
  for (const adapter of adapters) {
    seenNames.add(adapter.name);
    await processDevice(
      store,
      notify,
      state,
      adapter.name,
      "adapter",
      adapter.state,
      null
    );
  }

  // Process levers
  for (const lever of levers) {
    seenNames.add(lever.name);
    await processDevice(
      store,
      notify,
      state,
      lever.name,
      "lever",
      lever.state,
      lever.springReturn
    );
  }

  // Check for disappeared devices
  const allDevices = store.listDevices();
  for (const dev of allDevices) {
    if (!seenNames.has(dev.name)) {
      const count = (state.missedPolls.get(dev.name) ?? 0) + 1;
      state.missedPolls.set(dev.name, count);
      if (count === 3) {
        await notify({
          type: "device_disappeared",
          deviceName: dev.name,
          message: `Device no longer detected: ${dev.name}`,
        });
      }
    } else {
      state.missedPolls.delete(dev.name);
    }
  }
}

async function processDevice(
  store: Store,
  notify: NotifyFn,
  state: PollerState,
  name: string,
  type: string,
  currentState: boolean,
  springReturn: boolean | null
) {
  const existing = store.getDevice(name);

  if (!existing) {
    // New device
    store.upsertDevice({ name, type, state: currentState, springReturn });
    await notify({
      type: "device_discovered",
      deviceName: name,
      message: `New ${type} detected: ${name}`,
    });
    return;
  }

  // Update last_seen
  store.upsertDevice({ name, type, state: currentState, springReturn });

  // Check for state change
  const previousState = existing.currentState === 1;
  if (currentState !== previousState) {
    store.recordStateChange(name, currentState, "poll");

    // Evaluate watchers
    const watchers = store.getActiveWatchers();
    for (const watcher of watchers) {
      const result = evaluateWatcher(
        watcher,
        name,
        currentState,
        previousState,
        store
      );
      if (result) {
        await notify({
          watcherId: result.watcherId,
          type: "watcher",
          deviceName: result.deviceName,
          message: result.message,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/poller.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts test/poller.test.ts
git commit -m "feat: add poller with device discovery, state tracking, and watcher eval"
```

---

## Task 8: Webhook Receiver

**Files:**
- Create: `src/webhook.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/webhook.ts
import type { Store } from "./store";

type NotifyFn = (event: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) => Promise<void>;

export function startWebhookServer(
  port: number,
  store: Store,
  notify: NotifyFn
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const pathMatch = url.pathname.match(/^\/webhook\/(.+)$/);
      if (!pathMatch) {
        return new Response("not found", { status: 404 });
      }

      const adapterName = decodeURIComponent(pathMatch[1]);
      const existing = store.getDevice(adapterName);

      if (!existing) {
        // Auto-discover from webhook
        store.upsertDevice({
          name: adapterName,
          type: "adapter",
          state: true,
        });
        await notify({
          type: "device_discovered",
          deviceName: adapterName,
          message: `New adapter detected via webhook: ${adapterName}`,
        });
      }

      // Parse the body if present (Timberborn may send state info)
      let body: string | null = null;
      try {
        body = await req.text();
      } catch {}

      // Record as a state change (webhook = state went true / was triggered)
      const previousState = existing ? existing.currentState === 1 : false;
      const newState = true; // Webhook firing means the adapter signal is active
      if (newState !== previousState) {
        store.recordStateChange(adapterName, newState, "webhook");
      }
      store.upsertDevice({
        name: adapterName,
        type: "adapter",
        state: newState,
      });

      return new Response("ok");
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webhook.ts
git commit -m "feat: add webhook receiver for Timberborn HTTP Adapter pushes"
```

---

## Task 9: MCP Tool Handlers

**Files:**
- Create: `src/tools/devices.ts`
- Create: `src/tools/history.ts`
- Create: `src/tools/levers.ts`
- Create: `src/tools/watchers.ts`
- Create: `src/tools/status.ts`

- [ ] **Step 1: Write devices tools**

```ts
// src/tools/devices.ts
import type { Store } from "../store";

export function listDevicesHandler(store: Store, args: Record<string, unknown>) {
  const type = args.type as string | undefined;
  const group = args.group as string | undefined;
  const devices = store.listDevices({ type, group });
  return { content: [{ type: "text" as const, text: JSON.stringify(devices, null, 2) }] };
}

export function getDeviceHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string;
  const device = store.getDevice(name);
  if (!device) {
    return { content: [{ type: "text" as const, text: `Device not found: ${name}` }], isError: true };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(device, null, 2) }] };
}

export function annotateDeviceHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string;
  const label = (args.label as string) ?? null;
  const group = (args.group as string) ?? null;
  const device = store.getDevice(name);
  if (!device) {
    return { content: [{ type: "text" as const, text: `Device not found: ${name}` }], isError: true };
  }
  store.annotateDevice(name, label ?? device.label, group ?? device.groupName);
  return { content: [{ type: "text" as const, text: `Updated ${name}` }] };
}
```

- [ ] **Step 2: Write history tool**

```ts
// src/tools/history.ts
import type { Store } from "../store";

export function queryHistoryHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string | undefined;
  const group = args.group as string | undefined;
  const since = args.since as string | undefined;
  const until = args.until as string | undefined;
  const limit = args.limit as number | undefined;
  const history = store.queryHistory({ name, group, since, until, limit: limit ?? 100 });
  return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
}
```

- [ ] **Step 3: Write levers tool**

```ts
// src/tools/levers.ts
import type { Store } from "../store";
import type { TimberbornClient } from "../timberborn";

export async function switchLeverHandler(
  store: Store,
  client: TimberbornClient,
  args: Record<string, unknown>
) {
  const name = args.name as string;
  const action = args.action as "on" | "off" | "color";
  const value = args.value as string | undefined;

  let success = false;
  if (action === "on") {
    success = await client.switchOn(name);
  } else if (action === "off") {
    success = await client.switchOff(name);
  } else if (action === "color" && value) {
    success = await client.setColor(name, value);
  }

  const dbAction = action === "on" ? "switch-on" : action === "off" ? "switch-off" : "color";
  store.logCommand(name, dbAction, value ?? null, success);

  if (!success) {
    return { content: [{ type: "text" as const, text: `Failed to ${action} lever: ${name}` }], isError: true };
  }
  return { content: [{ type: "text" as const, text: `Lever ${name}: ${action}${value ? ` (${value})` : ""} — success` }] };
}
```

- [ ] **Step 4: Write watchers tools**

```ts
// src/tools/watchers.ts
import type { Store } from "../store";

export function createWatcherHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  const deviceName = (args.device_name as string) ?? null;
  const groupName = (args.group_name as string) ?? null;
  const condition = args.condition as string;

  store.createWatcher({ id, deviceName, groupName, condition });
  return { content: [{ type: "text" as const, text: `Watcher '${id}' created: ${condition}` }] };
}

export function listWatchersHandler(store: Store) {
  const watchers = store.listWatchers();
  return { content: [{ type: "text" as const, text: JSON.stringify(watchers, null, 2) }] };
}

export function deleteWatcherHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  store.deleteWatcher(id);
  return { content: [{ type: "text" as const, text: `Watcher '${id}' deleted` }] };
}
```

- [ ] **Step 5: Write status tool**

```ts
// src/tools/status.ts
import type { Store } from "../store";
import type { PollerState } from "../poller";

export function getStatusHandler(store: Store, pollerState: PollerState) {
  const devices = store.listDevices();
  const adapters = devices.filter((d) => d.type === "adapter");
  const levers = devices.filter((d) => d.type === "lever");
  const watchers = store.listWatchers();
  const recentEvents = store.getRecentEvents(5);

  const status = {
    connected: pollerState.connected,
    devices: {
      total: devices.length,
      adapters: adapters.length,
      levers: levers.length,
    },
    watchers: watchers.length,
    recentEvents,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/
git commit -m "feat: add all MCP tool handlers (devices, history, levers, watchers, status)"
```

---

## Task 10: MCP Server Entry Point

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Write the MCP server**

```ts
// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "util";
import { join } from "path";
import { loadConfig } from "./config";
import { Store } from "./store";
import { TimberbornClient } from "./timberborn";
import { Notifier } from "./notifier";
import { pollOnce, type PollerState } from "./poller";
import { evaluateDurationWatchers } from "./watcher";
import { startWebhookServer } from "./webhook";
import { listDevicesHandler, getDeviceHandler, annotateDeviceHandler } from "./tools/devices";
import { queryHistoryHandler } from "./tools/history";
import { switchLeverHandler } from "./tools/levers";
import { createWatcherHandler, listWatchersHandler, deleteWatcherHandler } from "./tools/watchers";
import { getStatusHandler } from "./tools/status";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { project: { type: "string" } },
});

if (!values.project) {
  console.error("Usage: bun src/server.ts --project <path>");
  process.exit(1);
}

const config = loadConfig(values.project);
const store = new Store(join(config.projectDir, "history.db"));
const tbClient = new TimberbornClient(config.timberborn.host, config.timberborn.port);

const mcp = new Server(
  { name: "timberborn", version: "0.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      "Events from the timberborn channel arrive as <channel source=\"timberborn\" type=\"...\" ...>.",
      "System events (device_discovered, device_disappeared, connection_lost, connection_restored) fire automatically.",
      "Watcher events fire when conditions you registered via the create_watcher tool are met.",
      "Use the MCP tools to query devices, history, control levers, and manage watchers.",
    ].join(" "),
  }
);

const notifier = new Notifier(mcp, store);

const pollerState: PollerState = {
  missedPolls: new Map(),
  connected: true,
};

// --- Tool definitions ---

const TOOLS = [
  {
    name: "list_devices",
    description: "List all known Timberborn devices (adapters and levers)",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Filter by type: 'adapter' or 'lever'" },
        group: { type: "string", description: "Filter by group name" },
      },
    },
  },
  {
    name: "get_device",
    description: "Get details for a single Timberborn device",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Device name" },
      },
      required: ["name"],
    },
  },
  {
    name: "annotate_device",
    description: "Set label and/or group on a device for organizing and watcher targeting",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Device name" },
        label: { type: "string", description: "Human-readable label (e.g. 'water > 50')" },
        group: { type: "string", description: "Group name (e.g. 'water-monitoring')" },
      },
      required: ["name"],
    },
  },
  {
    name: "query_history",
    description: "Query state change history for devices",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Filter by device name" },
        group: { type: "string", description: "Filter by group name" },
        since: { type: "string", description: "ISO 8601 start time" },
        until: { type: "string", description: "ISO 8601 end time" },
        limit: { type: "number", description: "Max results (default 100)" },
      },
    },
  },
  {
    name: "switch_lever",
    description: "Control a Timberborn lever: switch on, off, or set color",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Lever name" },
        action: { type: "string", enum: ["on", "off", "color"], description: "Action to perform" },
        value: { type: "string", description: "Hex color (only for 'color' action)" },
      },
      required: ["name", "action"],
    },
  },
  {
    name: "create_watcher",
    description: "Register a condition that pushes a channel notification when met. Conditions: state_changed, state_true, state_false, state_false_duration > Xm, state_true_duration > Xm, all_false, any_false",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Unique watcher ID (you choose)" },
        device_name: { type: "string", description: "Watch a specific device" },
        group_name: { type: "string", description: "Watch a group (for all_false/any_false)" },
        condition: { type: "string", description: "Condition expression" },
      },
      required: ["id", "condition"],
    },
  },
  {
    name: "list_watchers",
    description: "List all registered watchers",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_watcher",
    description: "Delete a watcher by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Watcher ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_status",
    description: "Get sidecar health, Timberborn connectivity, and device counts",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case "list_devices":
      return listDevicesHandler(store, a);
    case "get_device":
      return getDeviceHandler(store, a);
    case "annotate_device":
      return annotateDeviceHandler(store, a);
    case "query_history":
      return queryHistoryHandler(store, a);
    case "switch_lever":
      return switchLeverHandler(store, tbClient, a);
    case "create_watcher":
      return createWatcherHandler(store, a);
    case "list_watchers":
      return listWatchersHandler(store);
    case "delete_watcher":
      return deleteWatcherHandler(store, a);
    case "get_status":
      return getStatusHandler(store, pollerState);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// --- Connect and start ---

await mcp.connect(new StdioServerTransport());

// Start webhook receiver
startWebhookServer(config.poller.webhookPort, store, (e) => notifier.notify(e));

// Start poll loop
async function pollLoop() {
  while (true) {
    const adapters = await tbClient.getAdapters();
    const levers = await tbClient.getLevers();
    await pollOnce(adapters, levers, store, (e) => notifier.notify(e), pollerState);

    // Evaluate duration-based watchers
    const durationResults = evaluateDurationWatchers(store);
    for (const result of durationResults) {
      await notifier.notify({
        watcherId: result.watcherId,
        type: "watcher",
        deviceName: result.deviceName,
        message: result.message,
      });
    }

    await Bun.sleep(config.poller.intervalMs);
  }
}

// Start pruning loop (every hour)
async function pruneLoop() {
  while (true) {
    await Bun.sleep(3_600_000);
    store.prune(config.history.retentionMs);
  }
}

pollLoop();
pruneLoop();
```

- [ ] **Step 2: Verify it compiles**

Run: `bun build src/server.ts --target bun --outdir dist`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add MCP channel server entry point wiring everything together"
```

---

## Task 11: Integration Smoke Test

**Files:**
- Create: `test/integration.test.ts`

- [ ] **Step 1: Write integration test**

This test verifies the full flow: poller discovers devices, records state changes, evaluates watchers, and all tools work.

```ts
// test/integration.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import { pollOnce, type PollerState } from "../src/poller";
import type { Adapter, Lever } from "../src/timberborn";
import { listDevicesHandler, getDeviceHandler, annotateDeviceHandler } from "../src/tools/devices";
import { queryHistoryHandler } from "../src/tools/history";
import { createWatcherHandler, listWatchersHandler, deleteWatcherHandler } from "../src/tools/watchers";
import { getStatusHandler } from "../src/tools/status";

let store: Store;
const events: { type: string; deviceName?: string | null; message: string; watcherId?: string | null }[] = [];
const pollerState: PollerState = { missedPolls: new Map(), connected: true };

function mockNotify(e: any) {
  events.push(e);
  return Promise.resolve();
}

beforeEach(() => {
  store = new Store(":memory:");
  events.length = 0;
  pollerState.missedPolls = new Map();
  pollerState.connected = true;
});

describe("integration: poller → store → tools", () => {
  it("full lifecycle: discover, annotate, watch, trigger", async () => {
    // Step 1: Poll discovers devices
    const adapters: Adapter[] = [
      { name: "Water50", state: true },
      { name: "Water25", state: true },
    ];
    const levers: Lever[] = [{ name: "Pump", state: false, springReturn: false }];
    await pollOnce(adapters, levers, store, mockNotify, pollerState);

    expect(events).toHaveLength(3); // 3 device_discovered
    events.length = 0;

    // Step 2: Annotate devices
    annotateDeviceHandler(store, { name: "Water50", label: "water > 50", group: "water" });
    annotateDeviceHandler(store, { name: "Water25", label: "water > 25", group: "water" });

    // Step 3: List devices by group
    const result = listDevicesHandler(store, { group: "water" });
    const devices = JSON.parse(result.content[0].text);
    expect(devices).toHaveLength(2);

    // Step 4: Create a watcher
    createWatcherHandler(store, {
      id: "water-critical",
      group_name: "water",
      condition: "all_false",
    });
    const watcherList = JSON.parse(listWatchersHandler(store).content[0].text);
    expect(watcherList).toHaveLength(1);

    // Step 5: Poll with Water50 going false — watcher should NOT trigger (Water25 still true)
    await pollOnce(
      [{ name: "Water50", state: false }, { name: "Water25", state: true }],
      [{ name: "Pump", state: false, springReturn: false }],
      store,
      mockNotify,
      pollerState
    );
    const watcherEvents = events.filter((e) => e.type === "watcher");
    expect(watcherEvents).toHaveLength(0);

    // Step 6: Poll with both false — watcher SHOULD trigger
    events.length = 0;
    await pollOnce(
      [{ name: "Water50", state: false }, { name: "Water25", state: false }],
      [{ name: "Pump", state: false, springReturn: false }],
      store,
      mockNotify,
      pollerState
    );
    const triggered = events.filter((e) => e.type === "watcher");
    expect(triggered).toHaveLength(1);
    expect(triggered[0].watcherId).toBe("water-critical");

    // Step 7: Query history
    const history = JSON.parse(
      queryHistoryHandler(store, { name: "Water50" }).content[0].text
    );
    expect(history.length).toBeGreaterThanOrEqual(1);

    // Step 8: Get status
    const status = JSON.parse(
      getStatusHandler(store, pollerState).content[0].text
    );
    expect(status.connected).toBe(true);
    expect(status.devices.total).toBe(3);
    expect(status.watchers).toBe(1);

    // Step 9: Delete watcher
    deleteWatcherHandler(store, { id: "water-critical" });
    expect(JSON.parse(listWatchersHandler(store).content[0].text)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `bun test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: add integration test covering full poller → watcher → tools lifecycle"
```

---

## Task 12: Final Wiring and Sample Project

**Files:**
- Modify: `package.json` (add scripts)
- Create: `projects/example/config.yaml` (if not already created)

- [ ] **Step 1: Add scripts to package.json**

Add to the `"scripts"` section:

```json
{
  "scripts": {
    "start": "bun src/server.ts",
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add start and test scripts"
```

- [ ] **Step 4: Push to GitHub**

```bash
git push -u origin main
```
