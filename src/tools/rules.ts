import type { Store } from "../store";
import type { Condition, Action } from "../rule-types";
import { evaluateCondition } from "../rule-engine";

// ── Duration parsing ──────────────────────────────────────────────────────────

const DURATION_PATTERN = /^(\d+)(s|m|h)$/;

function parseCooldown(s: string | undefined): number | null {
  if (!s) return null;
  const match = DURATION_PATTERN.exec(s);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    default: return null;
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function error(t: string) {
  return { content: [{ type: "text" as const, text: t }], isError: true as const };
}

// ── Action validation ────────────────────────────────────────────────────────

/** Validate action tree. Returns error message or null if valid. */
function validateAction(action: Action): string | null {
  switch (action.type) {
    case "switch":
      if (action.value !== undefined && typeof action.value !== "boolean") {
        return `switch action 'value' must be a boolean (true/false), got ${typeof action.value}: ${JSON.stringify(action.value)}`;
      }
      return null;
    case "sequence":
      for (const sub of action.actions) {
        const err = validateAction(sub);
        if (err) return err;
      }
      return null;
    default:
      return null;
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export function createRuleHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;

  if (store.getRule(id) !== null) {
    return error(`Rule '${id}' already exists`);
  }

  const name = (args.name as string | undefined) ?? null;
  const group = (args.group as string | undefined) ?? null;
  const mode = args.mode as "edge" | "continuous";
  const condition = args.condition as Condition;
  const action = args.action as Action;
  const actionErr = validateAction(action);
  if (actionErr) return error(actionErr);
  const cooldownMs = parseCooldown(args.cooldown as string | undefined);

  store.createRule({ id, name, group, mode, condition, action, cooldownMs });
  return text(`Rule '${id}' created`);
}

export function listRulesHandler(store: Store, args: Record<string, unknown>) {
  const group = args.group as string | undefined;
  const enabledArg = args.enabled as boolean | undefined;

  const rows = store.listRules({
    group,
    enabled: enabledArg,
  });

  const rules = rows.map((row) => ({
    id: row.id,
    name: row.name,
    group: row.group_name,
    mode: row.mode,
    condition: JSON.parse(row.condition_json) as Condition,
    action: JSON.parse(row.action_json) as Action,
    cooldownMs: row.cooldown_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  }));

  return text(JSON.stringify(rules, null, 2));
}

export function getRuleHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  const row = store.getRule(id);

  if (row === null) {
    return error(`Rule '${id}' not found`);
  }

  const executions = store.getRuleExecutions(id, 10);

  const result = {
    id: row.id,
    name: row.name,
    group: row.group_name,
    mode: row.mode,
    condition: JSON.parse(row.condition_json) as Condition,
    action: JSON.parse(row.action_json) as Action,
    cooldownMs: row.cooldown_ms,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    executions,
  };

  return text(JSON.stringify(result, null, 2));
}

export function updateRuleHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;

  if (store.getRule(id) === null) {
    return error(`Rule '${id}' not found`);
  }

  const params: Parameters<Store["updateRule"]>[1] = {};

  if ("name" in args) params.name = (args.name as string | null) ?? null;
  if ("group" in args) params.group = (args.group as string | null) ?? null;
  if ("mode" in args) params.mode = args.mode as "edge" | "continuous";
  if ("condition" in args) params.condition = args.condition as Condition;
  if ("action" in args) {
    const action = args.action as Action;
    const actionErr = validateAction(action);
    if (actionErr) return error(actionErr);
    params.action = action;
  }
  if ("cooldown" in args) params.cooldownMs = parseCooldown(args.cooldown as string | undefined);
  if ("enabled" in args) params.enabled = args.enabled as boolean;

  store.updateRule(id, params);
  return text(`Rule '${id}' updated`);
}

export function deleteRuleHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  store.deleteRule(id);
  return text(`Rule '${id}' deleted`);
}

export function testRuleHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  const row = store.getRule(id);

  if (row === null) {
    return error(`Rule '${id}' not found`);
  }

  const condition = JSON.parse(row.condition_json) as Condition;
  const action = JSON.parse(row.action_json) as Action;
  const conditionResult = evaluateCondition(condition, store);

  const result = {
    ruleId: id,
    conditionResult,
    wouldExecute: conditionResult,
    action,
  };

  return text(JSON.stringify(result, null, 2));
}

export function enableRulesHandler(store: Store, args: Record<string, unknown>) {
  const group = args.group as string;
  store.setGroupEnabled(group, true);
  return text(`Rules in group '${group}' enabled`);
}

export function disableRulesHandler(store: Store, args: Record<string, unknown>) {
  const group = args.group as string;
  store.setGroupEnabled(group, false);
  return text(`Rules in group '${group}' disabled`);
}
