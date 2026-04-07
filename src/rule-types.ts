// src/rule-types.ts

// ── Conditions ──────────────────────────────────────────────────────────

export type Condition =
  | DeviceCondition
  | NotCondition
  | AndCondition
  | OrCondition
  | DurationCondition
  | GroupAllCondition
  | GroupAnyCondition;

export interface DeviceCondition {
  type: "device";
  name: string;
  state: boolean;
}

export interface NotCondition {
  type: "not";
  condition: Condition;
}

export interface AndCondition {
  type: "and";
  conditions: Condition[];
}

export interface OrCondition {
  type: "or";
  conditions: Condition[];
}

export interface DurationCondition {
  type: "duration";
  name: string;
  state: boolean;
  duration: string; // "30s", "5m", "1h"
}

export interface GroupAllCondition {
  type: "group_all";
  group: string;
  state: boolean;
}

export interface GroupAnyCondition {
  type: "group_any";
  group: string;
  state: boolean;
}

// ── Actions ─────────────────────────────────────────────────────────────

export type Action =
  | SwitchAction
  | NotifyAction
  | EnableGroupAction
  | DisableGroupAction
  | SequenceAction;

export interface SwitchAction {
  type: "switch";
  lever: string;
  value?: boolean;
}

export interface NotifyAction {
  type: "notify";
  message: string;
}

export interface EnableGroupAction {
  type: "enable_group";
  group: string;
}

export interface DisableGroupAction {
  type: "disable_group";
  group: string;
}

export interface SequenceAction {
  type: "sequence";
  actions: Action[];
}

// ── Rules ───────────────────────────────────────────────────────────────

export interface Rule {
  id: string;
  name: string | null;
  group: string | null;
  condition: Condition;
  action: Action;
  cooldownMs: number | null;
  enabled: boolean;
  createdAt: string;
}

// ── Storage row (JSON serialized condition/action) ──────────────────────

export interface RuleRow {
  id: string;
  name: string | null;
  group_name: string | null;
  condition_json: string;
  action_json: string;
  cooldown_ms: number | null;
  enabled: number;
  created_at: string;
}

export interface RuleExecutionRow {
  id: number;
  rule_id: string;
  timestamp: string;
  trigger_device: string | null;
  action_summary: string;
  success: number;
}
