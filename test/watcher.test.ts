import { describe, it, expect, beforeEach } from "bun:test";
import { evaluateWatcher } from "../src/watcher";
import { Store } from "../src/store";

let store: Store;

beforeEach(() => {
  store = new Store(":memory:");
});

describe("evaluateWatcher", () => {
  it("state_changed triggers on any transition", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_changed", active: 1, createdAt: "" },
      "A1", true, false, store
    );
    expect(result).not.toBeNull();
    expect(result!.message).toContain("state changed");
  });

  it("state_false triggers when device goes false", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_false", active: 1, createdAt: "" },
      "A1", false, true, store
    );
    expect(result).not.toBeNull();
  });

  it("state_false does not trigger when device goes true", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_false", active: 1, createdAt: "" },
      "A1", true, false, store
    );
    expect(result).toBeNull();
  });

  it("state_true triggers when device goes true", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A1", groupName: null, condition: "state_true", active: 1, createdAt: "" },
      "A1", true, false, store
    );
    expect(result).not.toBeNull();
  });

  it("all_false triggers when all group devices are false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: false });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");
    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "all_false", active: 1, createdAt: "" },
      "A1", false, true, store
    );
    expect(result).not.toBeNull();
    expect(result!.message).toContain("all devices in group");
  });

  it("all_false does not trigger when one device is still true", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");
    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "all_false", active: 1, createdAt: "" },
      "A1", false, true, store
    );
    expect(result).toBeNull();
  });

  it("any_false triggers when at least one device is false", () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: false });
    store.upsertDevice({ name: "A2", type: "adapter", state: true });
    store.annotateDevice("A1", null, "water");
    store.annotateDevice("A2", null, "water");
    const result = evaluateWatcher(
      { id: "w1", deviceName: null, groupName: "water", condition: "any_false", active: 1, createdAt: "" },
      "A1", false, true, store
    );
    expect(result).not.toBeNull();
  });

  it("ignores watchers for a different device", () => {
    const result = evaluateWatcher(
      { id: "w1", deviceName: "A2", groupName: null, condition: "state_changed", active: 1, createdAt: "" },
      "A1", true, false, store
    );
    expect(result).toBeNull();
  });
});
