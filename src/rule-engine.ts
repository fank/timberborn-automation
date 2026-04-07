import type { Condition, Action } from "./rule-types";
import type { Store } from "./store";
import type { TimberbornClient } from "./timberborn";
import type { NotifyFn } from "./poller";

// ── Duration parsing ─────────────────────────────────────────────────────────

const DURATION_PATTERN = /^(\d+)(s|m|h)$/;

function parseDurationMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration.trim());
  if (match === null) return 0;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: return 0;
  }
}

// ── Condition evaluator ──────────────────────────────────────────────────────

export function evaluateCondition(condition: Condition, store: Store): boolean {
  switch (condition.type) {
    case "device": {
      const device = store.getDevice(condition.name);
      if (device === null) return false;
      return (device.currentState === 1) === condition.state;
    }

    case "not": {
      return !evaluateCondition(condition.condition, store);
    }

    case "and": {
      return condition.conditions.every((c) => evaluateCondition(c, store));
    }

    case "or": {
      return condition.conditions.some((c) => evaluateCondition(c, store));
    }

    case "group_all": {
      const devices = store.listDevices({ group: condition.group });
      if (devices.length === 0) return false;
      return devices.every((d) => (d.currentState === 1) === condition.state);
    }

    case "group_any": {
      const devices = store.listDevices({ group: condition.group });
      if (devices.length === 0) return false;
      return devices.some((d) => (d.currentState === 1) === condition.state);
    }

    case "duration": {
      const device = store.getDevice(condition.name);
      if (device === null) return false;

      // Device must currently be in the target state
      if ((device.currentState === 1) !== condition.state) return false;

      // Find the most recent state change
      const history = store.queryHistory({ name: condition.name, limit: 1 });
      if (history.length === 0) return false;

      const lastChange = history[history.length - 1];
      if (lastChange.state !== (condition.state ? 1 : 0)) return false;

      const thresholdMs = parseDurationMs(condition.duration);
      const elapsed = Date.now() - new Date(lastChange.timestamp).getTime();
      return elapsed >= thresholdMs;
    }
  }
}

// ── Helper functions ─────────────────────────────────────────────────────────

export function extractDeviceNames(condition: Condition): Set<string> {
  const names = new Set<string>();

  function walk(c: Condition): void {
    switch (c.type) {
      case "device":
        names.add(c.name);
        break;
      case "duration":
        names.add(c.name);
        break;
      case "not":
        walk(c.condition);
        break;
      case "and":
      case "or":
        c.conditions.forEach(walk);
        break;
      case "group_all":
      case "group_any":
        // group conditions don't reference specific device names
        break;
    }
  }

  walk(condition);
  return names;
}

export function hasDurationCondition(condition: Condition): boolean {
  switch (condition.type) {
    case "duration":
      return true;
    case "not":
      return hasDurationCondition(condition.condition);
    case "and":
    case "or":
      return condition.conditions.some(hasDurationCondition);
    default:
      return false;
  }
}

// ── RuleEngine ───────────────────────────────────────────────────────────────

export class RuleEngine {
  private lastFired = new Map<string, number>(); // rule id → timestamp ms
  private lastConditionResult = new Map<string, boolean>(); // rule id → last evaluated result

  constructor(
    private store: Store,
    private client: Pick<TimberbornClient, "switchOn" | "switchOff">,
    private notify: NotifyFn
  ) {}

  isCoolingDown(ruleId: string, cooldownMs: number): boolean {
    const last = this.lastFired.get(ruleId);
    if (last === undefined) return false;
    return Date.now() - last < cooldownMs;
  }

  async executeAction(
    action: Action,
    ruleId: string,
    triggerDevice: string | null
  ): Promise<void> {
    switch (action.type) {
      case "switch": {
        const on = action.value ?? true;
        const summary = `switch ${action.lever} ${on ? "on" : "off"}`;
        let success: boolean;
        try {
          success = on
            ? await this.client.switchOn(action.lever)
            : await this.client.switchOff(action.lever);
        } catch {
          success = false;
        }

        this.store.logRuleExecution({
          ruleId,
          triggerDevice,
          actionSummary: summary,
          success,
        });
        this.store.logCommand(action.lever, on ? "switch-on" : "switch-off", null, success);

        if (!success) {
          await this.notify({
            watcherId: ruleId,
            type: "rule_error",
            deviceName: action.lever,
            message: `Rule ${ruleId}: failed to ${on ? "switch on" : "switch off"} ${action.lever}`,
          });
        }
        break;
      }

      case "notify": {
        await this.notify({
          watcherId: ruleId,
          type: "rule_notify",
          deviceName: triggerDevice,
          message: action.message,
        });
        break;
      }

      case "enable_group": {
        this.store.setGroupEnabled(action.group, true);
        this.store.logRuleExecution({
          ruleId,
          triggerDevice,
          actionSummary: `enable_group ${action.group}`,
          success: true,
        });
        break;
      }

      case "disable_group": {
        this.store.setGroupEnabled(action.group, false);
        this.store.logRuleExecution({
          ruleId,
          triggerDevice,
          actionSummary: `disable_group ${action.group}`,
          success: true,
        });
        break;
      }

      case "sequence": {
        for (const subAction of action.actions) {
          await this.executeAction(subAction, ruleId, triggerDevice);
        }
        break;
      }
    }
  }

  async onStateChange(
    changedDevice: string,
    newState: boolean,
    previousState: boolean
  ): Promise<void> {
    const rows = this.store.listRules({ enabled: true });

    for (const row of rows) {
      const condition: Condition = JSON.parse(row.condition_json);
      const action: Action = JSON.parse(row.action_json);
      const cooldownMs = row.cooldown_ms ?? 0;

      if (row.mode === "edge") {
        // Only evaluate if the changed device is referenced in the condition
        const referenced = extractDeviceNames(condition);
        if (referenced.size > 0 && !referenced.has(changedDevice)) continue;

        const result = evaluateCondition(condition, this.store);
        const prev = this.lastConditionResult.get(row.id) ?? false;
        this.lastConditionResult.set(row.id, result);

        // Edge rules only fire on false→true transition of the condition
        if (!result || prev) continue;

        if (cooldownMs > 0 && this.isCoolingDown(row.id, cooldownMs)) continue;

        this.lastFired.set(row.id, Date.now());
        await this.executeAction(action, row.id, changedDevice);
      } else if (row.mode === "continuous") {
        // Only evaluate if the changed device is referenced in the condition
        const referenced = extractDeviceNames(condition);
        if (!referenced.has(changedDevice)) continue;

        const result = evaluateCondition(condition, this.store);

        // For continuous mode with a switch action, only fire if result differs from current lever state
        if (action.type === "switch") {
          const lever = this.store.getDevice(action.lever);
          const currentLeverState = lever !== null ? lever.currentState === 1 : null;
          if (currentLeverState !== null && result === currentLeverState) continue;
        }

        if (cooldownMs > 0 && this.isCoolingDown(row.id, cooldownMs)) continue;

        this.lastFired.set(row.id, Date.now());

        // For continuous switch, the lever tracks the condition result
        if (action.type === "switch") {
          await this.executeAction({ ...action, value: result }, row.id, changedDevice);
        } else {
          await this.executeAction(action, row.id, changedDevice);
        }
      }
    }
  }

  async evaluateDurationRules(): Promise<void> {
    const rows = this.store.listRules({ enabled: true });

    for (const row of rows) {
      const condition: Condition = JSON.parse(row.condition_json);

      if (!hasDurationCondition(condition)) continue;

      const result = evaluateCondition(condition, this.store);
      if (!result) continue;

      const cooldownMs = row.cooldown_ms ?? 0;
      if (cooldownMs > 0 && this.isCoolingDown(row.id, cooldownMs)) continue;

      this.lastFired.set(row.id, Date.now());

      const action: Action = JSON.parse(row.action_json);
      await this.executeAction(action, row.id, null);
    }
  }
}
