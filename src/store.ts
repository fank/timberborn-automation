import { Database } from "bun:sqlite";

export interface DeviceRow {
  name: string;
  type: string;
  currentState: number;
  springReturn: number;
  label: string | null;
  groupName: string | null;
  status: string;
  firstSeen: string;
  lastSeen: string;
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
  deviceName: string;
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
  timestamp: string;
  watcherId: string | null;
  type: string;
  deviceName: string | null;
  message: string;
}

export class Store {
  public db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        name        TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        current_state INTEGER NOT NULL DEFAULT 0,
        spring_return INTEGER NOT NULL DEFAULT 0,
        label       TEXT,
        group_name  TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        first_seen  TEXT NOT NULL,
        last_seen   TEXT NOT NULL
      )
    `);

    // Migration: add status column to existing databases
    const cols = this.db.query<{ name: string }, []>(
      `PRAGMA table_info(devices)`
    ).all();
    if (!cols.some(c => c.name === "status")) {
      this.db.run(`ALTER TABLE devices ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS state_changes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        device_name TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        state       INTEGER NOT NULL,
        source      TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_state_changes_device_ts
        ON state_changes (device_name, timestamp)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS commands (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        device_name TEXT NOT NULL,
        timestamp   TEXT NOT NULL,
        action      TEXT NOT NULL,
        value       TEXT,
        success     INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchers (
        id          TEXT PRIMARY KEY,
        device_name TEXT,
        group_name  TEXT,
        condition   TEXT NOT NULL,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   TEXT NOT NULL,
        watcher_id  TEXT,
        type        TEXT NOT NULL,
        device_name TEXT,
        message     TEXT NOT NULL
      )
    `);
  }

  // ── devices ──────────────────────────────────────────────────────────────

  upsertDevice(params: {
    name: string;
    type: string;
    state: boolean;
    springReturn?: boolean;
  }): void {
    const now = new Date().toISOString();
    const stateInt = params.state ? 1 : 0;
    const springReturnInt = params.springReturn ? 1 : 0;

    const existing = this.getDevice(params.name);
    if (existing === null) {
      this.db.run(
        `INSERT INTO devices (name, type, current_state, spring_return, status, first_seen, last_seen)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [params.name, params.type, stateInt, springReturnInt, now, now]
      );
    } else {
      this.db.run(
        `UPDATE devices SET type = ?, current_state = ?, spring_return = ?, status = 'active', last_seen = ?
         WHERE name = ?`,
        [params.type, stateInt, springReturnInt, now, params.name]
      );
    }
  }

  getDevice(name: string): DeviceRow | null {
    const row = this.db
      .query<DeviceRow, [string]>(
        `SELECT
           name,
           type,
           current_state  AS currentState,
           spring_return  AS springReturn,
           label,
           group_name     AS groupName,
           status,
           first_seen     AS firstSeen,
           last_seen      AS lastSeen
         FROM devices
         WHERE name = ?`
      )
      .get(name);
    return row ?? null;
  }

  listDevices(filter: { type?: string; group?: string; includeDisappeared?: boolean } = {}): DeviceRow[] {
    const conditions: string[] = [];
    const values: string[] = [];

    if (!filter.includeDisappeared) {
      conditions.push("status = 'active'");
    }
    if (filter.type !== undefined) {
      conditions.push("type = ?");
      values.push(filter.type);
    }
    if (filter.group !== undefined) {
      conditions.push("group_name = ?");
      values.push(filter.group);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .query<DeviceRow, string[]>(
        `SELECT
           name,
           type,
           current_state  AS currentState,
           spring_return  AS springReturn,
           label,
           group_name     AS groupName,
           status,
           first_seen     AS firstSeen,
           last_seen      AS lastSeen
         FROM devices
         ${where}`
      )
      .all(...values);
  }

  setDeviceStatus(name: string, status: "active" | "disappeared"): void {
    this.db.run(`UPDATE devices SET status = ? WHERE name = ?`, [status, name]);
  }

  removeDevice(name: string): void {
    this.db.run(`DELETE FROM devices WHERE name = ?`, [name]);
  }

  annotateDevice(name: string, label: string, groupName: string): void {
    this.db.run(
      `UPDATE devices SET label = ?, group_name = ? WHERE name = ?`,
      [label, groupName, name]
    );
  }

  // ── state_changes ─────────────────────────────────────────────────────────

  recordStateChange(deviceName: string, state: boolean, source: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source) VALUES (?, ?, ?, ?)`,
      [deviceName, now, state ? 1 : 0, source]
    );
  }

  queryHistory(filter: {
    name?: string;
    group?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): StateChangeRow[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    const needsJoin = filter.group !== undefined;

    if (filter.name !== undefined) {
      conditions.push("sc.device_name = ?");
      values.push(filter.name);
    }
    if (filter.group !== undefined) {
      conditions.push("d.group_name = ?");
      values.push(filter.group);
    }
    if (filter.since !== undefined) {
      conditions.push("sc.timestamp >= ?");
      values.push(filter.since);
    }
    if (filter.until !== undefined) {
      conditions.push("sc.timestamp <= ?");
      values.push(filter.until);
    }

    const join = needsJoin
      ? "JOIN devices d ON d.name = sc.device_name"
      : "";
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = filter.limit !== undefined ? `LIMIT ${filter.limit}` : "";

    return this.db
      .query<StateChangeRow, (string | number)[]>(
        `SELECT
           sc.id,
           sc.device_name AS deviceName,
           sc.timestamp,
           sc.state,
           sc.source
         FROM state_changes sc
         ${join}
         ${where}
         ORDER BY sc.timestamp ASC
         ${limitClause}`
      )
      .all(...values);
  }

  // ── commands ──────────────────────────────────────────────────────────────

  logCommand(
    deviceName: string,
    action: string,
    value: string | null,
    success: boolean
  ): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO commands (device_name, timestamp, action, value, success) VALUES (?, ?, ?, ?, ?)`,
      [deviceName, now, action, value, success ? 1 : 0]
    );
  }

  getCommands(deviceName: string): CommandRow[] {
    return this.db
      .query<CommandRow, [string]>(
        `SELECT
           id,
           device_name AS deviceName,
           timestamp,
           action,
           value,
           success
         FROM commands
         WHERE device_name = ?
         ORDER BY timestamp ASC`
      )
      .all(deviceName);
  }

  // ── watchers ──────────────────────────────────────────────────────────────

  createWatcher(params: {
    id: string;
    deviceName: string | null;
    groupName: string | null;
    condition: string;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO watchers (id, device_name, group_name, condition, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [params.id, params.deviceName, params.groupName, params.condition, now]
    );
  }

  listWatchers(): WatcherRow[] {
    return this.db
      .query<WatcherRow, []>(
        `SELECT
           id,
           device_name AS deviceName,
           group_name  AS groupName,
           condition,
           active,
           created_at  AS createdAt
         FROM watchers
         ORDER BY created_at ASC`
      )
      .all();
  }

  getActiveWatchers(): WatcherRow[] {
    return this.db
      .query<WatcherRow, []>(
        `SELECT
           id,
           device_name AS deviceName,
           group_name  AS groupName,
           condition,
           active,
           created_at  AS createdAt
         FROM watchers
         WHERE active = 1
         ORDER BY created_at ASC`
      )
      .all();
  }

  deleteWatcher(id: string): void {
    this.db.run(`DELETE FROM watchers WHERE id = ?`, [id]);
  }

  // ── events ────────────────────────────────────────────────────────────────

  logEvent(params: {
    watcherId: string | null;
    type: string;
    deviceName?: string | null;
    message: string;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO events (timestamp, watcher_id, type, device_name, message)
       VALUES (?, ?, ?, ?, ?)`,
      [now, params.watcherId, params.type, params.deviceName ?? null, params.message]
    );
  }

  getRecentEvents(limit: number): EventRow[] {
    return this.db
      .query<EventRow, [number]>(
        `SELECT
           id,
           timestamp,
           watcher_id  AS watcherId,
           type,
           device_name AS deviceName,
           message
         FROM events
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(limit);
  }

  // ── pruning ───────────────────────────────────────────────────────────────

  prune(retentionMs: number): void {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    this.db.run(`DELETE FROM state_changes WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM commands WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM events WHERE timestamp < ?`, [cutoff]);
  }
}
