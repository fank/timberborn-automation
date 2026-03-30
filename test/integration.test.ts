import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";
import { pollOnce, type PollerState } from "../src/poller";
import type { Adapter, Lever } from "../src/timberborn";
import { listDevicesHandler, getDeviceHandler, annotateDeviceHandler } from "../src/tools/devices";
import { queryHistoryHandler } from "../src/tools/history";
import { createWatcherHandler, listWatchersHandler, deleteWatcherHandler } from "../src/tools/watchers";
import { getStatusHandler } from "../src/tools/status";

let store: Store;
const events: { type: string; deviceName?: string | null; message: string; watcherId?: string | null }[] = [];
const pollerState: PollerState = { missedPolls: new Map(), connected: true };

function mockNotify(e: any) {
  events.push(e);
  return Promise.resolve();
}

beforeEach(() => {
  store = new Store(":memory:");
  events.length = 0;
  pollerState.missedPolls = new Map();
  pollerState.connected = true;
});

describe("integration: poller → store → tools", () => {
  it("full lifecycle: discover, annotate, watch, trigger", async () => {
    // Step 1: Poll discovers devices
    const adapters: Adapter[] = [
      { name: "Water50", state: true },
      { name: "Water25", state: true },
    ];
    const levers: Lever[] = [{ name: "Pump", state: false, springReturn: false }];
    await pollOnce(adapters, levers, store, mockNotify, pollerState);
    expect(events).toHaveLength(3); // 3 device_discovered
    events.length = 0;

    // Step 2: Annotate devices
    annotateDeviceHandler(store, { name: "Water50", label: "water > 50", group: "water" });
    annotateDeviceHandler(store, { name: "Water25", label: "water > 25", group: "water" });

    // Step 3: List devices by group
    const result = listDevicesHandler(store, { group: "water" });
    const devices = JSON.parse(result.content[0].text);
    expect(devices).toHaveLength(2);

    // Step 4: Create a watcher
    createWatcherHandler(store, { id: "water-critical", group_name: "water", condition: "all_false" });
    const watcherList = JSON.parse(listWatchersHandler(store).content[0].text);
    expect(watcherList).toHaveLength(1);

    // Step 5: Poll with Water50 going false — watcher should NOT trigger (Water25 still true)
    await pollOnce(
      [{ name: "Water50", state: false }, { name: "Water25", state: true }],
      [{ name: "Pump", state: false, springReturn: false }],
      store, mockNotify, pollerState
    );
    const watcherEvents = events.filter((e) => e.type === "watcher");
    expect(watcherEvents).toHaveLength(0);

    // Step 6: Poll with both false — watcher SHOULD trigger
    events.length = 0;
    await pollOnce(
      [{ name: "Water50", state: false }, { name: "Water25", state: false }],
      [{ name: "Pump", state: false, springReturn: false }],
      store, mockNotify, pollerState
    );
    const triggered = events.filter((e) => e.type === "watcher");
    expect(triggered).toHaveLength(1);
    expect(triggered[0].watcherId).toBe("water-critical");

    // Step 7: Query history
    const history = JSON.parse(queryHistoryHandler(store, { name: "Water50" }).content[0].text);
    expect(history.length).toBeGreaterThanOrEqual(1);

    // Step 8: Get status
    const status = JSON.parse(getStatusHandler(store, pollerState).content[0].text);
    expect(status.connected).toBe(true);
    expect(status.devices.total).toBe(3);
    expect(status.watchers).toBe(1);

    // Step 9: Delete watcher
    deleteWatcherHandler(store, { id: "water-critical" });
    expect(JSON.parse(listWatchersHandler(store).content[0].text)).toHaveLength(0);
  });
});
