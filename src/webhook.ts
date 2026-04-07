import type { Store } from "./store";
import { evaluateWatcher } from "./watcher";
import { renderDashboard } from "./dashboard";

type NotifyFn = (event: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) => Promise<void>;

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

export function startWebhookServer(
  port: number,
  store: Store,
  notify: NotifyFn,
  onStateChange?: (device: string, newState: boolean, prevState: boolean) => Promise<void>
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      // ── Dashboard & API ──────────────────────────────────────────────
      if (req.method === "GET") {
        if (url.pathname === "/") {
          return new Response(renderDashboard(), {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (url.pathname === "/api/devices") {
          return json(store.listDevices());
        }

        if (url.pathname === "/api/rules") {
          const rows = store.listRules();
          const rules = rows.map((r) => ({
            id: r.id,
            name: r.name,
            group: r.group_name,
            mode: r.mode,
            condition: JSON.parse(r.condition_json),
            action: JSON.parse(r.action_json),
            cooldownMs: r.cooldown_ms,
            enabled: r.enabled === 1,
            createdAt: r.created_at,
          }));
          return json(rules);
        }

        if (url.pathname === "/api/executions") {
          // Get recent executions across all rules
          const rows = store.db
            .query<any, [number]>(
              `SELECT id, rule_id, timestamp, trigger_device, action_summary, success
               FROM rule_executions ORDER BY timestamp DESC LIMIT ?`
            )
            .all(50);
          return json(rows);
        }

        if (url.pathname === "/api/events") {
          return json(store.getRecentEvents(50));
        }
      }

      // ── Webhook: Timberborn HTTP Adapter callbacks ───────────────────
      //   http://localhost:8081/on/{name}
      //   http://localhost:8081/off/{name}
      const pathMatch = url.pathname.match(/^\/(on|off)\/(.+)$/);
      if (!pathMatch) {
        return new Response("not found", { status: 404 });
      }

      const newState = pathMatch[1] === "on";
      const adapterName = decodeURIComponent(pathMatch[2]);
      const existing = store.getDevice(adapterName);

      if (!existing) {
        store.upsertDevice({ name: adapterName, type: "adapter", state: newState });
        await notify({
          type: "device_discovered",
          deviceName: adapterName,
          message: `New adapter detected via webhook: ${adapterName}`,
        });
      }

      const previousState = existing ? existing.currentState === 1 : false;
      if (newState !== previousState) {
        store.recordStateChange(adapterName, newState, "webhook");

        // Evaluate active watchers
        const watchers = store.getActiveWatchers();
        for (const watcher of watchers) {
          const result = evaluateWatcher(watcher, adapterName, newState, previousState, store);
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
      store.upsertDevice({ name: adapterName, type: "adapter", state: newState });

      if (newState !== previousState && onStateChange) {
        await onStateChange(adapterName, newState, previousState);
      }

      return new Response("ok");
    },
  });
}
