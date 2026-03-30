import { describe, it, expect, beforeEach } from "bun:test";
import { Store } from "../src/store";

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

describe("devices", () => {
  it("upserts and retrieves a device", () => {
    store.upsertDevice({ name: "Lever 1", type: "lever", state: true, springReturn: false });
    const dev = store.getDevice("Lever 1");
    expect(dev).not.toBeNull();
    expect(dev!.name).toBe("Lever 1");
    expect(dev!.type).toBe("lever");
    expect(dev!.currentState).toBe(1);
    expect(dev!.springReturn).toBe(0);
  });

  it("lists devices filtered by type", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "L1", type: "lever", state: true, springReturn: true });
    const adapters = store.listDevices({ type: "adapter" });
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe("A1");
  });

  it("lists devices filtered by group", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "water > 50", "water");
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    const water = store.listDevices({ group: "water" });
    expect(water).toHaveLength(1);
    expect(water[0].name).toBe("A1");
  });

  it("annotates a device with label and group", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.annotateDevice("A1", "water > 50", "water");
    const dev = store.getDevice("A1");
    expect(dev!.label).toBe("water > 50");
    expect(dev!.groupName).toBe("water");
  });
});

describe("state_changes", () => {
  it("records a state change", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.recordStateChange("A1", true, "poll");
    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(1);
    expect(history[0].source).toBe("poll");
  });

  it("filters history by time range", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.recordStateChange("A1", true, "poll");
    const future = store.queryHistory({ name: "A1", since: new Date(Date.now() + 60_000).toISOString() });
    expect(future).toHaveLength(0);
  });
});

describe("commands", () => {
  it("logs a lever command", () => {
    store.logCommand("L1", "switch-on", null, true);
    store.logCommand("L1", "color", "FF0000", true);
    const cmds = store.getCommands("L1");
    expect(cmds).toHaveLength(2);
    expect(cmds[1].action).toBe("color");
    expect(cmds[1].value).toBe("FF0000");
  });
});

describe("watchers", () => {
  it("creates and lists watchers", () => {
    store.createWatcher({ id: "w1", deviceName: "A1", groupName: null, condition: "state_changed" });
    const list = store.listWatchers();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("w1");
    expect(list[0].active).toBe(1);
  });

  it("deletes a watcher", () => {
    store.createWatcher({ id: "w1", deviceName: "A1", groupName: null, condition: "state_false" });
    store.deleteWatcher("w1");
    expect(store.listWatchers()).toHaveLength(0);
  });
});

describe("events", () => {
  it("logs an event", () => {
    store.logEvent({ watcherId: null, type: "device_discovered", deviceName: "A1", message: "New adapter detected: A1" });
    const events = store.getRecentEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("device_discovered");
  });
});

describe("pruning", () => {
  it("prunes old state_changes", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.db.run(`INSERT INTO state_changes (device_name, timestamp, state, source) VALUES ('A1', '2020-01-01T00:00:00.000Z', 0, 'poll')`);
    store.recordStateChange("A1", true, "poll");
    store.prune(1);
    const history = store.queryHistory({ name: "A1" });
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe(1);
  });
});
