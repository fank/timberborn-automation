import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { RuleEngine } from "../src/rule-engine";
import { pollOnce, type PollerState } from "../src/poller";
import { startWebhookServer } from "../src/webhook";
import type { Adapter, Lever } from "../src/timberborn";

let store: Store;
const events: any[] = [];
const leverSwitches: { name: string; on: boolean }[] = [];

function mockNotify(e: any) {
  events.push(e);
  return Promise.resolve();
}

const mockClient = {
  switchOn: async (name: string) => { leverSwitches.push({ name, on: true }); return true; },
  switchOff: async (name: string) => { leverSwitches.push({ name, on: false }); return true; },
};

beforeEach(() => {
  store = new Store(":memory:");
  events.length = 0;
  leverSwitches.length = 0;
});

describe("rules integration: poll → rule engine → lever switch", () => {
  it("edge rule: pump turns on when WaterEmpty becomes true, off when WaterFull becomes true", async () => {
    const pollerState: PollerState = { missedPolls: new Map(), connected: true };
    const engine = new RuleEngine(store, mockClient, mockNotify);

    // Create the initial devices via poll
    const adapters: Adapter[] = [
      { name: "WaterEmpty", state: false },
      { name: "WaterFull", state: false },
    ];
    const levers: Lever[] = [{ name: "Pump", state: false, springReturn: false }];
    await pollOnce(adapters, levers, store, mockNotify, pollerState);

    // Create two edge rules
    store.createRule({
      id: "pump-on",
      name: "Pump ON when WaterEmpty",
      group: "water",
      mode: "edge",
      condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });
    store.createRule({
      id: "pump-off",
      name: "Pump OFF when WaterFull",
      group: "water",
      mode: "edge",
      condition: { type: "device", name: "WaterFull", state: true },
      action: { type: "switch", lever: "Pump", value: false },
      cooldownMs: null,
    });

    // Poll with WaterEmpty=true → should fire pump-on
    await pollOnce(
      [{ name: "WaterEmpty", state: true }, { name: "WaterFull", state: false }],
      [{ name: "Pump", state: false, springReturn: false }],
      store, mockNotify, pollerState,
      (device, newState, prevState) => engine.onStateChange(device, newState, prevState)
    );

    expect(leverSwitches).toHaveLength(1);
    expect(leverSwitches[0]).toEqual({ name: "Pump", on: true });

    // Clear and poll with WaterEmpty=false + WaterFull=true → should fire pump-off
    // Pump state=true reflects that the previous rule switched it on
    leverSwitches.length = 0;
    await pollOnce(
      [{ name: "WaterEmpty", state: false }, { name: "WaterFull", state: true }],
      [{ name: "Pump", state: true, springReturn: false }],
      store, mockNotify, pollerState,
      (device, newState, prevState) => engine.onStateChange(device, newState, prevState)
    );

    expect(leverSwitches).toHaveLength(1);
    expect(leverSwitches[0]).toEqual({ name: "Pump", on: false });
  });

  it("continuous rule: lumberyard tracks compound condition across multiple polls", async () => {
    const pollerState: PollerState = { missedPolls: new Map(), connected: true };
    const engine = new RuleEngine(store, mockClient, mockNotify);

    // First poll discovers devices (LogLow=false, PlankHigh=false, Lumberyard=false)
    const adapters: Adapter[] = [
      { name: "LogLow", state: false },
      { name: "PlankHigh", state: false },
    ];
    const levers: Lever[] = [{ name: "Lumberyard", state: false, springReturn: false }];
    await pollOnce(adapters, levers, store, mockNotify, pollerState);

    // Create continuous rule: AND(NOT LogLow=true, NOT PlankHigh=true) → switch Lumberyard
    store.createRule({
      id: "lumberyard-rule",
      name: "Lumberyard continuous",
      group: null,
      mode: "continuous",
      condition: {
        type: "and",
        conditions: [
          { type: "not", condition: { type: "device", name: "LogLow", state: true } },
          { type: "not", condition: { type: "device", name: "PlankHigh", state: true } },
        ],
      },
      action: { type: "switch", lever: "Lumberyard" },
      cooldownMs: null,
    });

    // First poll with rule active: no state change → no rule fires
    // (devices are discovered, not changed from existing state)
    expect(leverSwitches).toHaveLength(0);

    // Second poll: PlankHigh becomes true → condition false, lever already off → no switch
    await pollOnce(
      [{ name: "LogLow", state: false }, { name: "PlankHigh", state: true }],
      [{ name: "Lumberyard", state: false, springReturn: false }],
      store, mockNotify, pollerState,
      (device, newState, prevState) => engine.onStateChange(device, newState, prevState)
    );
    expect(leverSwitches).toHaveLength(0);

    // Third poll: PlankHigh back to false → condition true, lever off → switch Lumberyard ON
    await pollOnce(
      [{ name: "LogLow", state: false }, { name: "PlankHigh", state: false }],
      [{ name: "Lumberyard", state: false, springReturn: false }],
      store, mockNotify, pollerState,
      (device, newState, prevState) => engine.onStateChange(device, newState, prevState)
    );
    expect(leverSwitches).toHaveLength(1);
    expect(leverSwitches[0]).toEqual({ name: "Lumberyard", on: true });
  });

  it("disable_group stops rules from firing", async () => {
    const pollerState: PollerState = { missedPolls: new Map(), connected: true };
    const engine = new RuleEngine(store, mockClient, mockNotify);

    // Discover device A1
    await pollOnce(
      [{ name: "A1", state: false }],
      [],
      store, mockNotify, pollerState
    );

    // Create edge rule in group "water"
    store.createRule({
      id: "r-disabled",
      name: "Edge rule in water group",
      group: "water",
      mode: "edge",
      condition: { type: "device", name: "A1", state: true },
      action: { type: "switch", lever: "SomeLever", value: true },
      cooldownMs: null,
    });

    // Disable the group
    store.setGroupEnabled("water", false);

    // Poll with A1=true → rule should NOT fire (disabled)
    await pollOnce(
      [{ name: "A1", state: true }],
      [],
      store, mockNotify, pollerState,
      (device, newState, prevState) => engine.onStateChange(device, newState, prevState)
    );

    expect(leverSwitches).toHaveLength(0);
  });
});

describe("rules integration: webhook → rule engine → lever switch", () => {
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  afterEach(() => {
    server?.stop(true);
  });

  it("webhook updates store before calling onStateChange so rule engine reads fresh state", async () => {
    const store = new Store(":memory:");
    const switches: { name: string; on: boolean }[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push({ name, on: true }); return true; },
      switchOff: async (name: string) => { switches.push({ name, on: false }); return true; },
    };
    const notify = async () => {};
    const engine = new RuleEngine(store, client, notify);

    // Pre-populate devices (as if discovered by a previous poll)
    store.upsertDevice({ name: "WaterEmpty", type: "adapter", state: false });
    store.upsertDevice({ name: "Pump", type: "lever", state: false });

    // Create edge rule: WaterEmpty=true → switch Pump on
    store.createRule({
      id: "pump-on",
      name: null,
      group: null,
      mode: "edge",
      condition: { type: "device", name: "WaterEmpty", state: true },
      action: { type: "switch", lever: "Pump", value: true },
      cooldownMs: null,
    });

    // Start webhook server wired to rule engine
    port = 19876 + Math.floor(Math.random() * 1000);
    server = startWebhookServer(port, store, notify, (d, n, p) => engine.onStateChange(d, n, p));

    // Send webhook: WaterEmpty goes true
    const res = await fetch(`http://127.0.0.1:${port}/on/WaterEmpty`);
    expect(res.status).toBe(200);

    // Rule should have fired because store was updated before onStateChange
    expect(switches).toHaveLength(1);
    expect(switches[0]).toEqual({ name: "Pump", on: true });

    // Verify store has the updated state
    const device = store.getDevice("WaterEmpty");
    expect(device!.currentState).toBe(1);
  });

  it("webhook state change triggers rule engine for compound conditions", async () => {
    const store = new Store(":memory:");
    const switches: { name: string; on: boolean }[] = [];
    const client = {
      switchOn: async (name: string) => { switches.push({ name, on: true }); return true; },
      switchOff: async (name: string) => { switches.push({ name, on: false }); return true; },
    };
    const notify = async () => {};
    const engine = new RuleEngine(store, client, notify);

    // Pre-populate: PlankLow=true, LogLow=false, LumberMill=off
    store.upsertDevice({ name: "PlankLow", type: "adapter", state: true });
    store.upsertDevice({ name: "LogLow", type: "adapter", state: false });
    store.upsertDevice({ name: "LumberMill", type: "lever", state: false });

    // Compound rule: PlankLow AND NOT LogLow → switch LumberMill on
    store.createRule({
      id: "mill-on",
      name: null,
      group: null,
      mode: "edge",
      condition: {
        type: "and",
        conditions: [
          { type: "device", name: "PlankLow", state: true },
          { type: "not", condition: { type: "device", name: "LogLow", state: true } },
        ],
      },
      action: { type: "switch", lever: "LumberMill", value: true },
      cooldownMs: null,
    });

    // Seed baseline via initialize (PlankLow=true, LogLow=false → condition true, lever off → resync)
    await engine.initialize();
    expect(switches).toHaveLength(1);
    switches.length = 0;

    // Now LogLow goes true via webhook → condition becomes false
    port = 19876 + Math.floor(Math.random() * 1000);
    server = startWebhookServer(port, store, notify, (d, n, p) => engine.onStateChange(d, n, p));

    await fetch(`http://127.0.0.1:${port}/on/LogLow`);

    // Condition is now false, so no additional switch should fire
    expect(switches).toHaveLength(0);

    // LogLow goes false again via webhook → condition true again, lever should resync
    store.upsertDevice({ name: "LumberMill", type: "lever", state: false }); // simulate manual off
    await fetch(`http://127.0.0.1:${port}/off/LogLow`);

    expect(switches).toHaveLength(1);
    expect(switches[0]).toEqual({ name: "LumberMill", on: true });
  });
});
