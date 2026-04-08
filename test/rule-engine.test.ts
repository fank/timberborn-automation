import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import { evaluateCondition, RuleEngine, extractDeviceNames, hasDurationCondition } from "../src/rule-engine";
import type { Condition, Action } from "../src/rule-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockClient(results: Map<string, boolean> = new Map()) {
  return {
    switchOn: async (name: string) => results.get(name) ?? true,
    switchOff: async (name: string) => results.get(name) ?? true,
  };
}

function mockNotify() {
  const calls: { type: string; message: string; deviceName?: string | null; watcherId?: string | null }[] = [];
  const fn = async (e: { type: string; message: string; deviceName?: string | null; watcherId?: string | null }) => {
    calls.push(e);
  };
  return { fn, calls };
}

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

// ── Task 3: evaluateCondition ────────────────────────────────────────────────

describe("evaluateCondition — device", () => {
  it("returns true when device state matches condition.state=true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const cond: Condition = { type: "device", name: "A1", state: true };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when device state does not match condition.state=true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    const cond: Condition = { type: "device", name: "A1", state: true };
    expect(evaluateCondition(cond, store)).toBe(false);
  });

  it("returns true when device state matches condition.state=false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    const cond: Condition = { type: "device", name: "A1", state: false };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false for missing device", () => {
    const cond: Condition = { type: "device", name: "MISSING", state: true };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — not", () => {
  it("inverts a true child", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const cond: Condition = { type: "not", condition: { type: "device", name: "A1", state: true } };
    expect(evaluateCondition(cond, store)).toBe(false);
  });

  it("inverts a false child", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    const cond: Condition = { type: "not", condition: { type: "device", name: "A1", state: true } };
    expect(evaluateCondition(cond, store)).toBe(true);
  });
});

describe("evaluateCondition — and", () => {
  it("returns true when all conditions are true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    const cond: Condition = {
      type: "and",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "device", name: "A2", state: true },
      ],
    };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when one condition is false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    const cond: Condition = {
      type: "and",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "device", name: "A2", state: true },
      ],
    };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — or", () => {
  it("returns true when one condition is true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    const cond: Condition = {
      type: "or",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "device", name: "A2", state: true },
      ],
    };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when all conditions are false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    const cond: Condition = {
      type: "or",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "device", name: "A2", state: true },
      ],
    };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — nested NOT+AND", () => {
  it("not(and(true, false)) === true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    const cond: Condition = {
      type: "not",
      condition: {
        type: "and",
        conditions: [
          { type: "device", name: "A1", state: true },
          { type: "device", name: "A2", state: true },
        ],
      },
    };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("not(and(true, true)) === false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    const cond: Condition = {
      type: "not",
      condition: {
        type: "and",
        conditions: [
          { type: "device", name: "A1", state: true },
          { type: "device", name: "A2", state: true },
        ],
      },
    };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — group_all", () => {
  it("returns true when all devices in group match state", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.annotateDevice("A1", "", "pumps");
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A2", "", "pumps");
    const cond: Condition = { type: "group_all", group: "pumps", state: true };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when one device does not match", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.annotateDevice("A1", "", "pumps");
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    store.annotateDevice("A2", "", "pumps");
    const cond: Condition = { type: "group_all", group: "pumps", state: true };
    expect(evaluateCondition(cond, store)).toBe(false);
  });

  it("returns false for empty group", () => {
    const cond: Condition = { type: "group_all", group: "empty", state: true };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — group_any", () => {
  it("returns true when at least one device matches", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "", "pumps");
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A2", "", "pumps");
    const cond: Condition = { type: "group_any", group: "pumps", state: true };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when no device matches", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "", "pumps");
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    store.annotateDevice("A2", "", "pumps");
    const cond: Condition = { type: "group_any", group: "pumps", state: true };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

describe("evaluateCondition — duration", () => {
  it("returns true when device has been in target state longer than threshold", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    store.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source) VALUES ('A1', ?, 1, 'poll')`,
      [tenMinAgo]
    );
    const cond: Condition = { type: "duration", name: "A1", state: true, duration: "5m" };
    expect(evaluateCondition(cond, store)).toBe(true);
  });

  it("returns false when device has not been in target state long enough", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    store.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source) VALUES ('A1', ?, 1, 'poll')`,
      [oneMinAgo]
    );
    const cond: Condition = { type: "duration", name: "A1", state: true, duration: "5m" };
    expect(evaluateCondition(cond, store)).toBe(false);
  });

  it("returns false when device state does not match target", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    store.db.run(
      `INSERT INTO state_changes (device_name, timestamp, state, source) VALUES ('A1', ?, 0, 'poll')`,
      [tenMinAgo]
    );
    const cond: Condition = { type: "duration", name: "A1", state: true, duration: "5m" };
    expect(evaluateCondition(cond, store)).toBe(false);
  });

  it("returns false for missing device", () => {
    const cond: Condition = { type: "duration", name: "MISSING", state: true, duration: "5m" };
    expect(evaluateCondition(cond, store)).toBe(false);
  });
});

// ── Task 4: RuleEngine ───────────────────────────────────────────────────────

describe("RuleEngine — switch action", () => {
  it("switch on: calls switchOn, logs execution with summary 'switch L1 on'", async () => {
    const { fn, calls } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);
    const ruleId = "r1";

    const action: Action = { type: "switch", lever: "L1", value: true };
    await engine.executeAction(action, ruleId, "A1");

    const execs = store.getRuleExecutions(ruleId, 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].action_summary).toBe("switch L1 on");
    expect(execs[0].success).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("switch off: calls switchOff, logs execution with summary 'switch L1 off'", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);
    const ruleId = "r2";

    const action: Action = { type: "switch", lever: "L1", value: false };
    await engine.executeAction(action, ruleId, null);

    const execs = store.getRuleExecutions(ruleId, 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].action_summary).toBe("switch L1 off");
    expect(execs[0].success).toBe(1);
  });

  it("switch failure: logs success=0 and sends rule_error notification", async () => {
    const { fn, calls } = mockNotify();
    const failMap = new Map([["L1", false]]);
    const engine = new RuleEngine(store, mockClient(failMap), fn);
    const ruleId = "r3";

    const action: Action = { type: "switch", lever: "L1", value: true };
    await engine.executeAction(action, ruleId, "A1");

    const execs = store.getRuleExecutions(ruleId, 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].success).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("rule_error");
  });
});

describe("RuleEngine — notify action", () => {
  it("sends rule_notify notification", async () => {
    const { fn, calls } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);

    const action: Action = { type: "notify", message: "Water level critical!" };
    await engine.executeAction(action, "r4", "A1");

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("rule_notify");
    expect(calls[0].message).toBe("Water level critical!");
  });
});

describe("RuleEngine — enable_group action", () => {
  it("enables all rules in the group", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "rg1", name: null, group: "water", condition: cond, action: act, cooldownMs: null });
    store.createRule({ id: "rg2", name: null, group: "water", condition: cond, action: act, cooldownMs: null });
    store.setGroupEnabled("water", false);
    expect(store.getRule("rg1")!.enabled).toBe(0);

    const action: Action = { type: "enable_group", group: "water" };
    await engine.executeAction(action, "r5", null);

    expect(store.getRule("rg1")!.enabled).toBe(1);
    expect(store.getRule("rg2")!.enabled).toBe(1);

    const execs = store.getRuleExecutions("r5", 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].action_summary).toBe("enable_group water");
  });
});

describe("RuleEngine — disable_group action", () => {
  it("disables all rules in the group", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({ id: "rg3", name: null, group: "pumps", condition: cond, action: act, cooldownMs: null });

    const action: Action = { type: "disable_group", group: "pumps" };
    await engine.executeAction(action, "r6", null);

    expect(store.getRule("rg3")!.enabled).toBe(0);

    const execs = store.getRuleExecutions("r6", 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].action_summary).toBe("disable_group pumps");
  });
});

describe("RuleEngine — sequence action", () => {
  it("executes all sub-actions in order", async () => {
    const { fn, calls } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);

    const action: Action = {
      type: "sequence",
      actions: [
        { type: "notify", message: "step 1" },
        { type: "notify", message: "step 2" },
        { type: "notify", message: "step 3" },
      ],
    };
    await engine.executeAction(action, "r7", null);

    expect(calls).toHaveLength(3);
    expect(calls[0].message).toBe("step 1");
    expect(calls[1].message).toBe("step 2");
    expect(calls[2].message).toBe("step 3");
  });
});

describe("RuleEngine — cooldown", () => {
  it("blocks re-execution within the cooldown window", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);
    const ruleId = "r8";

    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "L1", type: "lever", state: false });
    const cond: Condition = { type: "device", name: "A1", state: true };
    const act: Action = { type: "switch", lever: "L1", value: true };
    store.createRule({
      id: ruleId,
      name: null,
      group: null,
           condition: cond,
      action: act,
      cooldownMs: 60_000, // 1 minute
    });

    // First trigger: A1 goes false→true, condition=true
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    await engine.onStateChange("A1", true, false);
    const execsAfterFirst = store.getRuleExecutions(ruleId, 10);
    expect(execsAfterFirst).toHaveLength(1);

    // Second trigger immediately: should be blocked by cooldown
    await engine.onStateChange("A1", true, false);
    const execsAfterSecond = store.getRuleExecutions(ruleId, 10);
    expect(execsAfterSecond).toHaveLength(1);
  });
});

// ── Edge rule scoping (regression: rules must not fire on unrelated device changes) ──

describe("RuleEngine — edge rule scoping", () => {
  it("does not fire when an unrelated device changes", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);

    store.upsertDevice({ name: "WaterEmpty", type: "adapter", state: true });
    store.upsertDevice({ name: "Pump", type: "lever", state: false });
    store.upsertDevice({ name: "LogLow", type: "adapter", state: false });

    store.createRule({
      id: "pump-on",
      name: null,
      group: null,
           condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });

    // LogLow changes — pump rule should NOT fire even though WaterEmpty is true
    store.upsertDevice({ name: "LogLow", type: "adapter", state: true });
    await engine.onStateChange("LogLow", true, false);
    expect(store.getRuleExecutions("pump-on", 10)).toHaveLength(0);
  });

  it("only fires on false→true condition transition, not while condition stays true", async () => {
    const { fn } = mockNotify();
    const engine = new RuleEngine(store, mockClient(), fn);

    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "L1", type: "lever", state: false });

    store.createRule({
      id: "r1",
      name: null,
      group: null,
           condition: { type: "device", name: "A1", state: true },
      action: { type: "switch", lever: "L1", value: true },
      cooldownMs: null,
    });

    // First: A1 goes true — should fire
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    await engine.onStateChange("A1", true, false);
    expect(store.getRuleExecutions("r1", 10)).toHaveLength(1);

    // A1 goes false then true again — should fire again (new false→true edge)
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    await engine.onStateChange("A1", false, true);
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    await engine.onStateChange("A1", true, false);
    expect(store.getRuleExecutions("r1", 10)).toHaveLength(2);
  });
});

// ── Helper functions ─────────────────────────────────────────────────────────

describe("extractDeviceNames", () => {
  it("extracts names from device and duration nodes", () => {
    const cond: Condition = {
      type: "and",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "not", condition: { type: "device", name: "A2", state: false } },
        { type: "duration", name: "A3", state: true, duration: "5m" },
      ],
    };
    const names = extractDeviceNames(cond);
    expect(names.has("A1")).toBe(true);
    expect(names.has("A2")).toBe(true);
    expect(names.has("A3")).toBe(true);
    expect(names.size).toBe(3);
  });
});

// ── RuleEngine.initialize() ─────────────────────────────────────────────────

describe("RuleEngine.initialize — startup resync", () => {
  it("fires switch action when condition is true but lever is out of sync", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    // Lever is OFF but condition is true → should resync to ON
    store.upsertDevice({ name: "WaterEmpty", type: "adapter", state: true });
    store.upsertDevice({ name: "Pump", type: "lever", state: false });
    store.createRule({
      id: "pump-on",
      name: null,
      group: null,
           condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });

    await engine.initialize();

    expect(switches).toEqual(["on:Pump"]);
    const execs = store.getRuleExecutions("pump-on", 10);
    expect(execs).toHaveLength(1);
    expect(execs[0].success).toBe(1);
  });

  it("does not fire when condition is true and lever already matches", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    // Lever is already ON and condition is true → no resync needed
    store.upsertDevice({ name: "WaterEmpty", type: "adapter", state: true });
    store.upsertDevice({ name: "Pump", type: "lever", state: true });
    store.createRule({
      id: "pump-on",
      name: null,
      group: null,
           condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });

    await engine.initialize();

    expect(switches).toHaveLength(0);
    expect(store.getRuleExecutions("pump-on", 10)).toHaveLength(0);
  });

  it("does not fire when condition is false", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    store.upsertDevice({ name: "WaterEmpty", type: "adapter", state: false });
    store.upsertDevice({ name: "Pump", type: "lever", state: false });
    store.createRule({
      id: "pump-on",
      name: null,
      group: null,
           condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });

    await engine.initialize();

    expect(switches).toHaveLength(0);
  });

  it("seeds lastConditionResult so subsequent edge detection works correctly", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    // Condition is true and lever already matches action target → no resync at init
    store.upsertDevice({ name: "WaterFull", type: "adapter", state: true });
    store.upsertDevice({ name: "Pump", type: "lever", state: false }); // already off, action wants off
    store.createRule({
      id: "pump-off",
      name: null,
      group: null,
           condition: { type: "device", name: "WaterFull", state: true },
      action: { type: "switch", lever: "Pump", value: false },
      cooldownMs: null,
    });

    await engine.initialize();
    expect(switches).toHaveLength(0);

    // Now WaterFull goes false then true again — should fire as a real edge
    store.upsertDevice({ name: "WaterFull", type: "adapter", state: false });
    await engine.onStateChange("WaterFull", false, true);
    store.upsertDevice({ name: "WaterFull", type: "adapter", state: true });
    await engine.onStateChange("WaterFull", true, false);

    expect(switches).toEqual(["off:Pump"]);
  });

});

// ── RuleEngine.resetRule() ───────────────────────────────────────────────────

describe("RuleEngine.resetRule — clears stale tracking on rule update", () => {
  it("resyncs lever after condition is updated", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    store.upsertDevice({ name: "Sensor", type: "adapter", state: false });
    store.upsertDevice({ name: "Lever", type: "lever", state: false });

    // Create rule: Sensor=true → Lever on
    store.createRule({
      id: "r1",
      name: null,
      group: null,
      condition: { type: "device", name: "Sensor", state: true },
      action: { type: "switch", lever: "Lever", value: true },
      cooldownMs: null,
    });

    await engine.initialize();
    expect(switches).toHaveLength(0); // Sensor=false, no resync

    // Update rule condition to Sensor=false → Lever on (inverted)
    store.updateRule("r1", {
      condition: { type: "device", name: "Sensor", state: false },
    });

    // resetRule should detect condition is now true and lever is out of sync
    await engine.resetRule("r1");

    expect(switches).toEqual(["on:Lever"]);
  });

  it("does not fire if lever already matches after condition update", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    store.upsertDevice({ name: "Sensor", type: "adapter", state: true });
    store.upsertDevice({ name: "Lever", type: "lever", state: true });

    store.createRule({
      id: "r1",
      name: null,
      group: null,
      condition: { type: "device", name: "Sensor", state: true },
      action: { type: "switch", lever: "Lever", value: true },
      cooldownMs: null,
    });

    await engine.initialize();
    expect(switches).toHaveLength(0);

    // Reset without changing anything — should not fire
    await engine.resetRule("r1");
    expect(switches).toHaveLength(0);
  });

  it("clears lastConditionResult so next state change triggers a fresh edge", async () => {
    const { fn } = mockNotify();
    const switches: string[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push(`on:${name}`); return true; },
      switchOff: async (name: string) => { switches.push(`off:${name}`); return true; },
    };
    const engine = new RuleEngine(store, client, fn);

    store.upsertDevice({ name: "Sensor", type: "adapter", state: true });
    store.upsertDevice({ name: "Lever", type: "lever", state: false });

    store.createRule({
      id: "r1",
      name: null,
      group: null,
      condition: { type: "device", name: "Sensor", state: true },
      action: { type: "switch", lever: "Lever", value: true },
      cooldownMs: null,
    });

    // Initialize seeds baseline and resyncs
    await engine.initialize();
    expect(switches).toEqual(["on:Lever"]);
    switches.length = 0;

    // Sensor goes false then true — normal edge fires
    store.upsertDevice({ name: "Sensor", type: "adapter", state: false });
    await engine.onStateChange("Sensor", false, true);
    store.upsertDevice({ name: "Sensor", type: "adapter", state: true });
    store.upsertDevice({ name: "Lever", type: "lever", state: false });
    await engine.onStateChange("Sensor", true, false);
    expect(switches).toEqual(["on:Lever"]);
    switches.length = 0;

    // Now reset the rule — clears tracking
    await engine.resetRule("r1");
    // resetRule resynced already, clear
    switches.length = 0;

    // Sensor goes false then true again — should fire as fresh edge
    store.upsertDevice({ name: "Sensor", type: "adapter", state: false });
    await engine.onStateChange("Sensor", false, true);
    store.upsertDevice({ name: "Sensor", type: "adapter", state: true });
    store.upsertDevice({ name: "Lever", type: "lever", state: false });
    await engine.onStateChange("Sensor", true, false);
    expect(switches).toEqual(["on:Lever"]);
  });
});

describe("hasDurationCondition", () => {
  it("returns true when any node is a duration condition", () => {
    const cond: Condition = {
      type: "and",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "duration", name: "A2", state: true, duration: "10m" },
      ],
    };
    expect(hasDurationCondition(cond)).toBe(true);
  });

  it("returns false when no duration condition exists", () => {
    const cond: Condition = {
      type: "or",
      conditions: [
        { type: "device", name: "A1", state: true },
        { type: "not", condition: { type: "device", name: "A2", state: false } },
      ],
    };
    expect(hasDurationCondition(cond)).toBe(false);
  });
});
