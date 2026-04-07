import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Store } from "../src/store";
import { startWebhookServer } from "../src/webhook";

let store: Store;
let server: ReturnType<typeof startWebhookServer>;
let baseUrl: string;

function mockNotify() {
  return async () => {};
}

beforeEach(() => {
  store = new Store(":memory:");
  server = startWebhookServer(0, store, mockNotify());
  baseUrl = `http://localhost:${server.port}`;
});

afterEach(() => {
  server.stop();
});

describe("dashboard routes", () => {
  it("GET / returns HTML", async () => {
    const res = await fetch(baseUrl + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    const html = await res.text();
    expect(html).toContain("Timberborn Automation");
  });

  it("GET /api/devices returns JSON array", async () => {
    store.upsertDevice({ name: "A1", type: "adapter", state: true });
    store.upsertDevice({ name: "L1", type: "lever", state: false });
    const res = await fetch(baseUrl + "/api/devices");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe("A1");
  });

  it("GET /api/rules returns rules with parsed condition/action", async () => {
    store.createRule({
      id: "r1",
      name: "test",
      group: "water",
      mode: "edge",
      condition: { type: "device", name: "A1", state: true },
      action: { type: "switch", lever: "L1", value: true },
      cooldownMs: null,
    });
    const res = await fetch(baseUrl + "/api/rules");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].condition.type).toBe("device");
    expect(data[0].action.type).toBe("switch");
    expect(data[0].enabled).toBe(true);
  });

  it("GET /api/executions returns recent executions", async () => {
    store.logRuleExecution({ ruleId: "r1", triggerDevice: "A1", actionSummary: "switch L1 on", success: true });
    const res = await fetch(baseUrl + "/api/executions");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].rule_id).toBe("r1");
  });

  it("GET /api/events returns recent events", async () => {
    store.logEvent({ watcherId: null, type: "device_discovered", deviceName: "A1", message: "New" });
    const res = await fetch(baseUrl + "/api/events");
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("device_discovered");
  });

  it("webhook /on/:name still works alongside dashboard", async () => {
    const res = await fetch(baseUrl + "/on/TestAdapter");
    expect(res.status).toBe(200);
    const device = store.getDevice("TestAdapter");
    expect(device).not.toBeNull();
    expect(device!.currentState).toBe(1);
  });
});
