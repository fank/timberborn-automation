import { describe, it, expect } from "bun:test";
import { loadConfig, type Config } from "../src/config";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("loadConfig", () => {
  it("loads a valid config.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-test-"));
    writeFileSync(
      join(dir, "config.yaml"),
      `timberborn:
  host: localhost
  port: 8080
poller:
  interval: 5s
  webhook_port: 9090
history:
  retention: 168h
`
    );
    const cfg = loadConfig(dir);
    expect(cfg.timberborn.host).toBe("localhost");
    expect(cfg.timberborn.port).toBe(8080);
    expect(cfg.poller.intervalMs).toBe(5000);
    expect(cfg.poller.webhookPort).toBe(9090);
    expect(cfg.history.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(cfg.projectDir).toBe(dir);
  });

  it("uses defaults when fields are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "tb-test-"));
    writeFileSync(join(dir, "config.yaml"), "");
    const cfg = loadConfig(dir);
    expect(cfg.timberborn.host).toBe("localhost");
    expect(cfg.timberborn.port).toBe(8080);
    expect(cfg.poller.intervalMs).toBe(5000);
    expect(cfg.poller.webhookPort).toBe(9090);
    expect(cfg.history.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
