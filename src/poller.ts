import type { Store } from "./store";
import type { Adapter, Lever } from "./timberborn";
import { evaluateWatcher } from "./watcher";

export interface PollerState {
  missedPolls: Map<string, number>;
  connected: boolean;
}

export type NotifyFn = (event: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) => Promise<void>;

export async function pollOnce(
  adapters: Adapter[] | null,
  levers: Lever[] | null,
  store: Store,
  notify: NotifyFn,
  state: PollerState
): Promise<void> {
  // Handle null (connection failure)
  if (adapters === null || levers === null) {
    if (state.connected) {
      state.connected = false;
      await notify({
        type: "connection_lost",
        deviceName: null,
        message: "Connection to Timberborn lost",
      });
    }
    return;
  }

  // Handle reconnect
  if (!state.connected) {
    state.connected = true;
    await notify({
      type: "connection_restored",
      deviceName: null,
      message: "Connection to Timberborn restored",
    });
  }

  // Build a set of seen device names in this poll
  const seenNames = new Set<string>();

  // Process adapters
  for (const adapter of adapters) {
    seenNames.add(adapter.name);
    state.missedPolls.delete(adapter.name);
    await processDevice(adapter.name, "adapter", adapter.state, false, store, notify);
  }

  // Process levers
  for (const lever of levers) {
    seenNames.add(lever.name);
    state.missedPolls.delete(lever.name);
    await processDevice(lever.name, "lever", lever.state, lever.springReturn, store, notify);
  }

  // Check for disappeared devices (only active ones)
  const activeDevices = store.listDevices();
  for (const device of activeDevices) {
    if (seenNames.has(device.name)) continue;

    const missed = (state.missedPolls.get(device.name) ?? 0) + 1;
    state.missedPolls.set(device.name, missed);

    if (missed === 3) {
      store.setDeviceStatus(device.name, "disappeared");
      await notify({
        type: "device_disappeared",
        deviceName: device.name,
        message: `Device ${device.name} has not been seen for 3 polls`,
      });
    }
  }
}

async function processDevice(
  name: string,
  type: string,
  state: boolean,
  springReturn: boolean,
  store: Store,
  notify: NotifyFn
): Promise<void> {
  const existing = store.getDevice(name);

  if (existing === null) {
    // New device discovered
    store.upsertDevice({ name, type, state, springReturn });
    await notify({
      type: "device_discovered",
      deviceName: name,
      message: `New ${type} detected: ${name}`,
    });
    return;
  }

  const previousState = existing.currentState === 1;
  store.upsertDevice({ name, type, state, springReturn });

  if (state !== previousState) {
    store.recordStateChange(name, state, "poll");

    // Evaluate active watchers
    const watchers = store.getActiveWatchers();
    for (const watcher of watchers) {
      const result = evaluateWatcher(watcher, name, state, previousState, store);
      if (result !== null) {
        await notify({
          watcherId: result.watcherId,
          type: "watcher",
          deviceName: result.deviceName,
          message: result.message,
        });
      }
    }
  }
}
