import { describe, it, expect, beforeEach } from "bun:test";
import { pollOnce } from "../src/poller";
import { Store } from "../src/store";
import type { Adapter, Lever } from "../src/timberborn";

let store: Store;
const events: { type: string; deviceName?: string | null; message: string }[] = [];

function mockNotify(e: { watcherId?: string | null; type: string; deviceName?: string | null; message: string }) {
  events.push(e);
  return Promise.resolve();
}

beforeEach(() => {
  store = new Store(":memory:");
  events.length = 0;
});

describe("pollOnce", () => {
  it("discovers new devices", async () => {
    const adapters: Adapter[] = [{ name: "A1", state: true }];
    const levers: Lever[] = [{ name: "L1", state: false, springReturn: true }];
    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce(adapters, levers, store, mockNotify, state);
    expect(store.getDevice("A1")).not.toBeNull();
    expect(store.getDevice("L1")).not.toBeNull();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("device_discovered");
    expect(events[1].type).toBe("device_discovered");
  });

  it("records state changes", async () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce([{ name: "A1", state: false }], [], store, mockNotify, state);
    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(0);
  });

  it("fires device_disappeared after 3 missed polls", async () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce([], [], store, mockNotify, state);
    await pollOnce([], [], store, mockNotify, state);
    await pollOnce([], [], store, mockNotify, state);
    const disappeared = events.filter((e) => e.type === "device_disappeared");
    expect(disappeared).toHaveLength(1);
    expect(disappeared[0].deviceName).toBe("A1");
  });

  it("fires connection_lost when null is passed", async () => {
    const state = { missedPolls: new Map<string, number>(), connected: true };
    await pollOnce(null, null, store, mockNotify, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("connection_lost");
    expect(state.connected).toBe(false);
  });

  it("fires connection_restored after reconnect", async () => {
    const state = { missedPolls: new Map<string, number>(), connected: false };
    await pollOnce([], [], store, mockNotify, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("connection_restored");
    expect(state.connected).toBe(true);
  });
});
