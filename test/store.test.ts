import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import type { Condition, Action } from "../src/rule-types";

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

describe("devices", () => {
  it("upserts and retrieves a device", () => {
    store.upsertDevice({ name: "Lever 1", type: "lever", state: true, springReturn: false });
    const dev = store.getDevice("Lever 1");
    expect(dev).not.toBeNull();
    expect(dev!.name).toBe("Lever 1");
    expect(dev!.type).toBe("lever");
    expect(dev!.currentState).toBe(1);
    expect(dev!.springReturn).toBe(0);
  });

  it("lists devices filtered by type", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "L1", type: "lever", state: true, springReturn: true });
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
    const future = store.queryHistory({ name: "A1", since: new Date(Date.now() + 60_000).toISOString() });
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
    store.createWatcher({ id: "w1", deviceName: "A1", groupName: null, condition: "state_changed" });
    const list = store.listWatchers();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("w1");
    expect(list[0].active).toBe(1);
  });

  it("deletes a watcher", () => {
    store.createWatcher({ id: "w1", deviceName: "A1", groupName: null, condition: "state_false" });
    store.deleteWatcher("w1");
    expect(store.listWatchers()).toHaveLength(0);
  });
});

describe("events", () => {
  it("logs an event", () => {
    store.logEvent({ watcherId: null, type: "device_discovered", deviceName: "A1", message: "New adapter detected: A1" });
    const events = store.getRecentEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("device_discovered");
  });
});

describe("pruning", () => {
  it("prunes old state_changes", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.db.run(`INSERT INTO state_changes (device_name, timestamp, state, source) VALUES ('A1', '2020-01-01T00:00:00.000Z', 0, 'poll')`);
    store.recordStateChange("A1", true, "poll");
    store.prune(1);
    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(1);
  });
});

describe("rules", () => {
  it("creates and retrieves a rule", () => {
    const condition: Condition = { type: "device", name: "A1", state: true };
    const action: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({
      id: "r1",
      name: "test rule",
      group: "water",
      mode: "edge",
      condition,
      action,
      cooldownMs: 10000,
    });
    const rule = store.getRule("r1");
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe("r1");
    expect(rule!.name).toBe("test rule");
    expect(rule!.group_name).toBe("water");
    expect(rule!.mode).toBe("edge");
    expect(rule!.cooldown_ms).toBe(10000);
    expect(rule!.enabled).toBe(1);
    expect(JSON.parse(rule!.condition_json)).toEqual(condition);
    expect(JSON.parse(rule!.action_json)).toEqual(action);
  });

  it("lists rules filtered by group", () => {
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "r1", name: null, group: "water", mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.createRule({ id: "r2", name: null, group: "wood", mode: "edge", condition: cond, action: act, cooldownMs: null });
    const water = store.listRules({ group: "water" });
    expect(water).toHaveLength(1);
    expect(water[0].id).toBe("r1");
  });

  it("lists only enabled rules", () => {
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "r1", name: null, group: null, mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.createRule({ id: "r2", name: null, group: null, mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.setRuleEnabled("r2", false);
    const enabled = store.listRules({ enabled: true });
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe("r1");
  });

  it("updates a rule", () => {
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "r1", name: "old", group: null, mode: "edge", condition: cond, action: act, cooldownMs: null });
    const newCond: Condition = { type: "device", name: "A2", state: false };
    store.updateRule("r1", { name: "new", condition: newCond, cooldownMs: 5000 });
    const rule = store.getRule("r1");
    expect(rule!.name).toBe("new");
    expect(rule!.cooldown_ms).toBe(5000);
    expect(JSON.parse(rule!.condition_json)).toEqual(newCond);
  });

  it("deletes a rule", () => {
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "r1", name: null, group: null, mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.deleteRule("r1");
    expect(store.getRule("r1")).toBeNull();
  });

  it("enables/disables rules by group", () => {
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "r1", name: null, group: "water", mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.createRule({ id: "r2", name: null, group: "water", mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.createRule({ id: "r3", name: null, group: "wood", mode: "edge", condition: cond, action: act, cooldownMs: null });
    store.setGroupEnabled("water", false);
    expect(store.getRule("r1")!.enabled).toBe(0);
    expect(store.getRule("r2")!.enabled).toBe(0);
    expect(store.getRule("r3")!.enabled).toBe(1);
  });

  it("logs and retrieves rule executions", () => {
    store.logRuleExecution({ ruleId: "r1", triggerDevice: "A1", actionSummary: "switch L1 on", success: true });
    const execs = store.getRuleExecutions("r1", 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].rule_id).toBe("r1");
    expect(execs[0].action_summary).toBe("switch L1 on");
    expect(execs[0].success).toBe(1);
  });
});
