import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";

export interface Config {
  projectDir: string;
  timberborn: {
    host: string;
    port: number;
  };
  poller: {
    intervalMs: number;
    webhookPort: number;
  };
  history: {
    retentionMs: number;
  };
}

function parseDuration(s: string | undefined, defaultMs: number): number {
  if (!s) return defaultMs;
  const match = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return defaultMs;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * (multipliers[unit] ?? 1);
}

export function loadConfig(projectDir: string): Config {
  projectDir = resolve(projectDir);
  if (!existsSync(projectDir)) {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  const configPath = join(projectDir, "config.yaml");
  let raw: Record<string, any> = {};
  if (existsSync(configPath)) {
    const text = readFileSync(configPath, "utf-8");
    raw = parseYaml(text) ?? {};
  }

  return {
    projectDir,
    timberborn: {
      host: raw?.timberborn?.host ?? "localhost",
      port: raw?.timberborn?.port ?? 8080,
    },
    poller: {
      intervalMs: parseDuration(raw?.poller?.interval, 5000),
      webhookPort: raw?.poller?.webhook_port ?? 9090,
    },
    history: {
      retentionMs: parseDuration(raw?.history?.retention, 7 * 24 * 3_600_000),
    },
  };
}
