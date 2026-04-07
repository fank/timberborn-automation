import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import {
  createRuleHandler,
  listRulesHandler,
  getRuleHandler,
  updateRuleHandler,
  deleteRuleHandler,
  testRuleHandler,
  enableRulesHandler,
  disableRulesHandler,
} from "../src/tools/rules";
import type { Condition, Action } from "../src/rule-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const edgeCondition: Condition = { type: "device", name: "Sensor 1", state: true };
const edgeAction: Action = { type: "notify", message: "Sensor 1 triggered" };

const contCondition: Condition = { type: "device", name: "Pump 1", state: true };
const contAction: Action = { type: "switch", lever: "Gate 1" };

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

// ── createRuleHandler ─────────────────────────────────────────────────────────

describe("createRuleHandler", () => {
  it("creates an edge rule", () => {
    const result = createRuleHandler(store, {
      id: "rule-1",
      name: "My Rule",
      group: "sensors",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
      cooldown: "30s",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("rule-1");

    const row = store.getRule("rule-1");
    expect(row).not.toBeNull();
    expect(row!.name).toBe("My Rule");
    expect(row!.group_name).toBe("sensors");
    expect(row!.mode).toBe("edge");
    expect(row!.cooldown_ms).toBe(30_000);
    expect(row!.enabled).toBe(1);
  });

  it("creates a continuous rule without cooldown", () => {
    const result = createRuleHandler(store, {
      id: "rule-cont",
      mode: "continuous",
      condition: contCondition,
      action: contAction,
    });

    expect(result.isError).toBeUndefined();

    const row = store.getRule("rule-cont");
    expect(row).not.toBeNull();
    expect(row!.mode).toBe("continuous");
    expect(row!.cooldown_ms).toBeNull();
    expect(row!.name).toBeNull();
    expect(row!.group_name).toBeNull();
  });

  it("rejects duplicate id", () => {
    createRuleHandler(store, {
      id: "rule-dup",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });

    const result = createRuleHandler(store, {
      id: "rule-dup",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });

  it("rejects string value in switch action", () => {
    const result = createRuleHandler(store, {
      id: "bad-value",
      mode: "edge",
      condition: edgeCondition,
      action: { type: "switch", lever: "L1", value: "off" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must be a boolean");
  });

  it("rejects string value inside sequence action", () => {
    const result = createRuleHandler(store, {
      id: "bad-seq",
      mode: "edge",
      condition: edgeCondition,
      action: {
        type: "sequence",
        actions: [
          { type: "switch", lever: "L1", value: "on" },
          { type: "notify", message: "test" },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must be a boolean");
  });
});

// ── listRulesHandler ──────────────────────────────────────────────────────────

describe("listRulesHandler", () => {
  beforeEach(() => {
    createRuleHandler(store, {
      id: "rule-a",
      group: "groupA",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });
    createRuleHandler(store, {
      id: "rule-b",
      group: "groupB",
      mode: "continuous",
      condition: contCondition,
      action: contAction,
    });
  });

  it("lists all rules", () => {
    const result = listRulesHandler(store, {});
    const rules = JSON.parse(result.content[0].text);

    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe("rule-a");
    expect(rules[1].id).toBe("rule-b");
  });

  it("returns parsed condition and action objects (not strings)", () => {
    const result = listRulesHandler(store, {});
    const rules = JSON.parse(result.content[0].text);

    expect(typeof rules[0].condition).toBe("object");
    expect(rules[0].condition.type).toBe("device");
    expect(typeof rules[0].action).toBe("object");
    expect(rules[0].action.type).toBe("notify");
  });

  it("filters by group", () => {
    const result = listRulesHandler(store, { group: "groupA" });
    const rules = JSON.parse(result.content[0].text);

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("rule-a");
  });

  it("filters by enabled", () => {
    store.setRuleEnabled("rule-b", false);
    const result = listRulesHandler(store, { enabled: true });
    const rules = JSON.parse(result.content[0].text);

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("rule-a");
  });
});

// ── getRuleHandler ────────────────────────────────────────────────────────────

describe("getRuleHandler", () => {
  beforeEach(() => {
    createRuleHandler(store, {
      id: "rule-get",
      name: "Get Me",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });
    store.logRuleExecution({
      ruleId: "rule-get",
      triggerDevice: "Sensor 1",
      actionSummary: "notify",
      success: true,
    });
  });

  it("returns parsed condition and action with executions", () => {
    const result = getRuleHandler(store, { id: "rule-get" });
    const rule = JSON.parse(result.content[0].text);

    expect(rule.id).toBe("rule-get");
    expect(rule.name).toBe("Get Me");
    expect(typeof rule.condition).toBe("object");
    expect(rule.condition.type).toBe("device");
    expect(typeof rule.action).toBe("object");
    expect(rule.action.type).toBe("notify");
    expect(rule.executions).toHaveLength(1);
    expect(rule.executions[0].rule_id).toBe("rule-get");
  });

  it("returns error for missing rule", () => {
    const result = getRuleHandler(store, { id: "no-such-rule" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});

// ── updateRuleHandler ─────────────────────────────────────────────────────────

describe("updateRuleHandler", () => {
  beforeEach(() => {
    createRuleHandler(store, {
      id: "rule-upd",
      name: "Original",
      group: "g1",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
      cooldown: "1m",
    });
  });

  it("updates name and group", () => {
    updateRuleHandler(store, { id: "rule-upd", name: "Updated", group: "g2" });
    const row = store.getRule("rule-upd");
    expect(row!.name).toBe("Updated");
    expect(row!.group_name).toBe("g2");
  });

  it("parses cooldown string to ms", () => {
    updateRuleHandler(store, { id: "rule-upd", cooldown: "2m" });
    const row = store.getRule("rule-upd");
    expect(row!.cooldown_ms).toBe(120_000);
  });

  it("updates enabled flag", () => {
    updateRuleHandler(store, { id: "rule-upd", enabled: false });
    const row = store.getRule("rule-upd");
    expect(row!.enabled).toBe(0);
  });

  it("returns error for missing rule", () => {
    const result = updateRuleHandler(store, { id: "no-such", name: "x" });
    expect(result.isError).toBe(true);
  });

  it("rejects string value in switch action", () => {
    const result = updateRuleHandler(store, {
      id: "rule-upd",
      action: { type: "switch", lever: "L1", value: "off" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must be a boolean");
    // Verify original action was NOT overwritten
    const row = store.getRule("rule-upd");
    const action = JSON.parse(row!.action_json);
    expect(action.type).toBe("notify"); // still the original fixture action
  });
});

// ── deleteRuleHandler ─────────────────────────────────────────────────────────

describe("deleteRuleHandler", () => {
  it("deletes a rule", () => {
    createRuleHandler(store, {
      id: "rule-del",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });

    const result = deleteRuleHandler(store, { id: "rule-del" });
    expect(result.isError).toBeUndefined();
    expect(store.getRule("rule-del")).toBeNull();
  });
});

// ── testRuleHandler ───────────────────────────────────────────────────────────

describe("testRuleHandler", () => {
  it("evaluates condition against current device state (true)", () => {
    store.upsertDevice({ name: "Sensor 1", type: "adapter", state: true });
    createRuleHandler(store, {
      id: "rule-test",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });

    const result = testRuleHandler(store, { id: "rule-test" });
    const data = JSON.parse(result.content[0].text);

    expect(data.ruleId).toBe("rule-test");
    expect(data.conditionResult).toBe(true);
    expect(data.wouldExecute).toBe(true);
    expect(data.action.type).toBe("notify");
  });

  it("evaluates condition against current device state (false)", () => {
    store.upsertDevice({ name: "Sensor 1", type: "adapter", state: false });
    createRuleHandler(store, {
      id: "rule-test-false",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });

    const result = testRuleHandler(store, { id: "rule-test-false" });
    const data = JSON.parse(result.content[0].text);

    expect(data.conditionResult).toBe(false);
    expect(data.wouldExecute).toBe(false);
  });

  it("returns error for missing rule", () => {
    const result = testRuleHandler(store, { id: "no-such" });
    expect(result.isError).toBe(true);
  });
});

// ── enableRulesHandler / disableRulesHandler ──────────────────────────────────

describe("enableRulesHandler / disableRulesHandler", () => {
  beforeEach(() => {
    createRuleHandler(store, {
      id: "rule-g1-a",
      group: "group1",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });
    createRuleHandler(store, {
      id: "rule-g1-b",
      group: "group1",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });
    createRuleHandler(store, {
      id: "rule-g2-a",
      group: "group2",
      mode: "edge",
      condition: edgeCondition,
      action: edgeAction,
    });
  });

  it("disables all rules in a group", () => {
    disableRulesHandler(store, { group: "group1" });
    const rows = store.listRules({ group: "group1" });
    expect(rows.every((r) => r.enabled === 0)).toBe(true);

    const g2 = store.listRules({ group: "group2" });
    expect(g2[0].enabled).toBe(1);
  });

  it("enables all rules in a group", () => {
    store.setGroupEnabled("group1", false);
    enableRulesHandler(store, { group: "group1" });
    const rows = store.listRules({ group: "group1" });
    expect(rows.every((r) => r.enabled === 1)).toBe(true);
  });

  it("returns success message", () => {
    const r1 = disableRulesHandler(store, { group: "group1" });
    expect(r1.content[0].text).toContain("group1");

    const r2 = enableRulesHandler(store, { group: "group1" });
    expect(r2.content[0].text).toContain("group1");
  });
});
