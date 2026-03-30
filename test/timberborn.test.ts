import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { TimberbornClient } from "../src/timberborn";

let server: ReturnType<typeof Bun.serve>;
let client: TimberbornClient;

const mockAdapters = [
  { name: "HTTP Adapter 1", state: true },
  { name: "HTTP Adapter 2", state: false },
];

const mockLevers = [
  { name: "HTTP Lever 1", state: true, springReturn: false },
];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/adapters") return Response.json(mockAdapters);
      if (url.pathname === "/api/levers") return Response.json(mockLevers);
      if (url.pathname === "/api/switch-on/HTTP%20Lever%201") return new Response("ok");
      if (url.pathname === "/api/switch-off/HTTP%20Lever%201") return new Response("ok");
      if (url.pathname === "/api/color/HTTP%20Lever%201/FF0000") return new Response("ok");
      return new Response("not found", { status: 404 });
    },
  });
  client = new TimberbornClient("localhost", server.port);
});

afterAll(() => { server.stop(); });

describe("TimberbornClient", () => {
  it("fetches adapters", async () => {
    const adapters = await client.getAdapters();
    expect(adapters).toHaveLength(2);
    expect(adapters[0].name).toBe("HTTP Adapter 1");
    expect(adapters[0].state).toBe(true);
  });

  it("fetches levers", async () => {
    const levers = await client.getLevers();
    expect(levers).toHaveLength(1);
    expect(levers[0].springReturn).toBe(false);
  });

  it("switches a lever on", async () => {
    const ok = await client.switchOn("HTTP Lever 1");
    expect(ok).toBe(true);
  });

  it("switches a lever off", async () => {
    const ok = await client.switchOff("HTTP Lever 1");
    expect(ok).toBe(true);
  });

  it("sets lever color", async () => {
    const ok = await client.setColor("HTTP Lever 1", "FF0000");
    expect(ok).toBe(true);
  });

  it("reports unreachable server", async () => {
    const bad = new TimberbornClient("localhost", 1);
    const adapters = await bad.getAdapters();
    expect(adapters).toBeNull();
  });
});
