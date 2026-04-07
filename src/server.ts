import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "util";
import { join } from "path";
import { loadConfig } from "./config";
import { Store } from "./store";
import { TimberbornClient } from "./timberborn";
import { Notifier } from "./notifier";
import { pollOnce, type PollerState } from "./poller";
import { evaluateDurationWatchers } from "./watcher";
import { startWebhookServer } from "./webhook";
import { listDevicesHandler, getDeviceHandler, removeDeviceHandler, annotateDeviceHandler } from "./tools/devices";
import { queryHistoryHandler } from "./tools/history";
import { switchLeverHandler } from "./tools/levers";
import { createWatcherHandler, listWatchersHandler, deleteWatcherHandler } from "./tools/watchers";
import { getStatusHandler } from "./tools/status";
import { RuleEngine } from "./rule-engine";
import {
  createRuleHandler,
  listRulesHandler,
  getRuleHandler,
  updateRuleHandler,
  deleteRuleHandler,
  testRuleHandler,
  enableRulesHandler,
  disableRulesHandler,
} from "./tools/rules";

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
      'Events from the timberborn channel arrive as <channel source="timberborn" type="..." ...>.',
      "System events (device_discovered, device_disappeared, connection_lost, connection_restored) fire automatically.",
      "Watcher events fire when conditions you registered via the create_watcher tool are met.",
      "Use the MCP tools to query devices, history, control levers, and manage watchers.",
    ].join(" "),
  }
);

const notifier = new Notifier(mcp, store);
const pollerState: PollerState = { missedPolls: new Map(), connected: true };
const ruleEngine = new RuleEngine(store, tbClient, (e) => notifier.notify(e));

const TOOLS = [
  {
    name: "list_devices",
    description: "List all known Timberborn devices (adapters and levers). By default only shows active devices.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", description: "Filter by type: 'adapter' or 'lever'" },
        group: { type: "string", description: "Filter by group name" },
        include_disappeared: { type: "boolean", description: "Include disappeared devices (default: false)" },
      },
    },
  },
  {
    name: "get_device",
    description: "Get details for a single Timberborn device",
    inputSchema: {
      type: "object" as const,
      properties: { name: { type: "string", description: "Device name" } },
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
    name: "remove_device",
    description: "Permanently remove a device from the database (e.g. after it was renamed or removed in-game)",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Device name to remove" },
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
      properties: { id: { type: "string", description: "Watcher ID" } },
      required: ["id"],
    },
  },
  {
    name: "get_status",
    description: "Get sidecar health, Timberborn connectivity, and device counts",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "create_rule",
    description: "Create an automation rule. Edge rules fire once on state transition. Continuous rules keep a lever tracking a boolean condition. Actions: switch (flip lever), notify (escalate to Claude), enable_group/disable_group (toggle rule groups), sequence (multiple actions).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Unique rule ID" },
        name: { type: "string", description: "Human-readable name" },
        group: { type: "string", description: "Rule group (for bulk enable/disable)" },
        mode: { type: "string", enum: ["edge", "continuous"], description: "edge: fires once on transition. continuous: lever tracks condition." },
        condition: {
          type: "object",
          description: "Boolean condition tree. Types: device {name, state}, not {condition}, and {conditions[]}, or {conditions[]}, duration {name, state, duration}, group_all {group, state}, group_any {group, state}",
        },
        action: {
          type: "object",
          description: "Action to execute. Types: switch {lever, value?}, notify {message}, enable_group {group}, disable_group {group}, sequence {actions[]}",
        },
        cooldown: { type: "string", description: "Cooldown duration (e.g. '10s', '5m')" },
      },
      required: ["id", "mode", "condition", "action"],
    },
  },
  {
    name: "list_rules",
    description: "List all automation rules",
    inputSchema: {
      type: "object" as const,
      properties: {
        group: { type: "string", description: "Filter by group" },
        enabled: { type: "boolean", description: "Filter by enabled state" },
      },
    },
  },
  {
    name: "get_rule",
    description: "Get details of a rule including recent executions",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Rule ID" } },
      required: ["id"],
    },
  },
  {
    name: "update_rule",
    description: "Update fields of an existing rule",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Rule ID" },
        name: { type: "string" },
        group: { type: "string" },
        mode: { type: "string", enum: ["edge", "continuous"] },
        condition: { type: "object" },
        action: { type: "object" },
        cooldown: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_rule",
    description: "Delete an automation rule",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Rule ID" } },
      required: ["id"],
    },
  },
  {
    name: "test_rule",
    description: "Dry-run: evaluate a rule's condition against current device state without executing the action",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Rule ID" } },
      required: ["id"],
    },
  },
  {
    name: "enable_rules",
    description: "Enable all rules in a group",
    inputSchema: {
      type: "object" as const,
      properties: { group: { type: "string", description: "Group name" } },
      required: ["group"],
    },
  },
  {
    name: "disable_rules",
    description: "Disable all rules in a group (e.g. during drought for manual control)",
    inputSchema: {
      type: "object" as const,
      properties: { group: { type: "string", description: "Group name" } },
      required: ["group"],
    },
  },
];

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case "list_devices": return listDevicesHandler(store, a);
    case "get_device": return getDeviceHandler(store, a);
    case "annotate_device": return annotateDeviceHandler(store, a);
    case "remove_device": return removeDeviceHandler(store, a);
    case "query_history": return queryHistoryHandler(store, a);
    case "switch_lever": return switchLeverHandler(store, tbClient, a);
    case "create_watcher": return createWatcherHandler(store, a);
    case "list_watchers": return listWatchersHandler(store);
    case "delete_watcher": return deleteWatcherHandler(store, a);
    case "get_status": return getStatusHandler(store, pollerState);
    case "create_rule": return createRuleHandler(store, a);
    case "list_rules": return listRulesHandler(store, a);
    case "get_rule": return getRuleHandler(store, a);
    case "update_rule": return updateRuleHandler(store, a);
    case "delete_rule": return deleteRuleHandler(store, a);
    case "test_rule": return testRuleHandler(store, a);
    case "enable_rules": return enableRulesHandler(store, a);
    case "disable_rules": return disableRulesHandler(store, a);
    default: throw new Error(`Unknown tool: ${name}`);
  }
});

await mcp.connect(new StdioServerTransport());

startWebhookServer(config.poller.webhookPort, store, (e) => notifier.notify(e), (d, n, p) => ruleEngine.onStateChange(d, n, p));

await ruleEngine.initialize();

async function pollLoop() {
  while (true) {
    const adapters = await tbClient.getAdapters();
    const levers = await tbClient.getLevers();
    await pollOnce(adapters, levers, store, (e) => notifier.notify(e), pollerState, (d, n, p) => ruleEngine.onStateChange(d, n, p));

    const durationResults = evaluateDurationWatchers(store);
    for (const result of durationResults) {
      await notifier.notify({
        watcherId: result.watcherId,
        type: "watcher",
        deviceName: result.deviceName,
        message: result.message,
      });
    }

    await ruleEngine.evaluateDurationRules();

    await Bun.sleep(config.poller.intervalMs);
  }
}

async function pruneLoop() {
  while (true) {
    await Bun.sleep(3_600_000);
    store.prune(config.history.retentionMs);
  }
}

pollLoop();
pruneLoop();
