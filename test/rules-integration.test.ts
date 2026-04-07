import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import { RuleEngine } from "../src/rule-engine";
import { pollOnce, type PollerState } from "../src/poller";
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
    leverSwitches.length = 0;
    await pollOnce(
      [{ name: "WaterEmpty", state: false }, { name: "WaterFull", state: true }],
      [{ name: "Pump", state: false, springReturn: false }],
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
