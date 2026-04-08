import { Database } from "bun:sqlite";
import type { Condition, Action, RuleRow, RuleExecutionRow } from "./rule-types";

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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS rules (
        id            TEXT PRIMARY KEY,
        name          TEXT,
        group_name    TEXT,
        mode          TEXT NOT NULL DEFAULT 'edge',
        condition_json TEXT NOT NULL,
        action_json   TEXT NOT NULL,
        cooldown_ms   INTEGER,
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS rule_executions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id         TEXT NOT NULL,
        timestamp       TEXT NOT NULL,
        trigger_device  TEXT,
        action_summary  TEXT NOT NULL,
        success         INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_rule_executions_rule_ts
        ON rule_executions (rule_id, timestamp)
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

  // ── rules ────────────────────────────────────────────────────────────────

  createRule(params: {
    id: string;
    name: string | null;
    group: string | null;
    condition: Condition;
    action: Action;
    cooldownMs: number | null;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO rules (id, name, group_name, mode, condition_json, action_json, cooldown_ms, enabled, created_at)
       VALUES (?, ?, ?, 'edge', ?, ?, ?, 1, ?)`,
      [
        params.id,
        params.name,
        params.group,
        JSON.stringify(params.condition),
        JSON.stringify(params.action),
        params.cooldownMs,
        now,
      ]
    );
  }

  getRule(id: string): RuleRow | null {
    const row = this.db
      .query<RuleRow, [string]>(
        `SELECT id, name, group_name, condition_json, action_json, cooldown_ms, enabled, created_at
         FROM rules WHERE id = ?`
      )
      .get(id);
    return row ?? null;
  }

  listRules(filter: { group?: string; enabled?: boolean } = {}): RuleRow[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (filter.group !== undefined) {
      conditions.push("group_name = ?");
      values.push(filter.group);
    }
    if (filter.enabled !== undefined) {
      conditions.push("enabled = ?");
      values.push(filter.enabled ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db
      .query<RuleRow, (string | number)[]>(
        `SELECT id, name, group_name, condition_json, action_json, cooldown_ms, enabled, created_at
         FROM rules ${where} ORDER BY created_at ASC`
      )
      .all(...values);
  }

  updateRule(
    id: string,
    params: {
      name?: string | null;
      group?: string | null;
      condition?: Condition;
      action?: Action;
      cooldownMs?: number | null;
      enabled?: boolean;
    }
  ): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (params.name !== undefined) { sets.push("name = ?"); values.push(params.name); }
    if (params.group !== undefined) { sets.push("group_name = ?"); values.push(params.group); }
    if (params.condition !== undefined) { sets.push("condition_json = ?"); values.push(JSON.stringify(params.condition)); }
    if (params.action !== undefined) { sets.push("action_json = ?"); values.push(JSON.stringify(params.action)); }
    if (params.cooldownMs !== undefined) { sets.push("cooldown_ms = ?"); values.push(params.cooldownMs); }
    if (params.enabled !== undefined) { sets.push("enabled = ?"); values.push(params.enabled ? 1 : 0); }

    if (sets.length === 0) return;
    values.push(id);
    this.db.run(`UPDATE rules SET ${sets.join(", ")} WHERE id = ?`, values);
  }

  deleteRule(id: string): void {
    this.db.run(`DELETE FROM rules WHERE id = ?`, [id]);
  }

  setRuleEnabled(id: string, enabled: boolean): void {
    this.db.run(`UPDATE rules SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, id]);
  }

  setGroupEnabled(group: string, enabled: boolean): void {
    this.db.run(`UPDATE rules SET enabled = ? WHERE group_name = ?`, [enabled ? 1 : 0, group]);
  }

  // ── rule_executions ──────────────────────────────────────────────────────

  logRuleExecution(params: {
    ruleId: string;
    triggerDevice: string | null;
    actionSummary: string;
    success: boolean;
  }): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO rule_executions (rule_id, timestamp, trigger_device, action_summary, success)
       VALUES (?, ?, ?, ?, ?)`,
      [params.ruleId, now, params.triggerDevice, params.actionSummary, params.success ? 1 : 0]
    );
  }

  getRuleExecutions(ruleId: string, limit: number): RuleExecutionRow[] {
    return this.db
      .query<RuleExecutionRow, [string, number]>(
        `SELECT id, rule_id, timestamp, trigger_device, action_summary, success
         FROM rule_executions WHERE rule_id = ? ORDER BY timestamp DESC LIMIT ?`
      )
      .all(ruleId, limit);
  }

  // ── pruning ───────────────────────────────────────────────────────────────

  prune(retentionMs: number): void {
    const cutoff = new Date(Date.now() - retentionMs).toISOString();
    this.db.run(`DELETE FROM state_changes WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM commands WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM events WHERE timestamp < ?`, [cutoff]);
    this.db.run(`DELETE FROM rule_executions WHERE timestamp < ?`, [cutoff]);
  }
}
