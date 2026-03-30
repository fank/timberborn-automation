import type { Store } from "./store";

type NotifyFn = (event: {
  watcherId?: string | null;
  type: string;
  deviceName?: string | null;
  message: string;
}) => Promise<void>;

export function startWebhookServer(
  port: number,
  store: Store,
  notify: NotifyFn
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const pathMatch = url.pathname.match(/^\/webhook\/(.+)$/);
      if (!pathMatch) {
        return new Response("not found", { status: 404 });
      }

      const adapterName = decodeURIComponent(pathMatch[1]);
      const existing = store.getDevice(adapterName);

      if (!existing) {
        store.upsertDevice({ name: adapterName, type: "adapter", state: true });
        await notify({
          type: "device_discovered",
          deviceName: adapterName,
          message: `New adapter detected via webhook: ${adapterName}`,
        });
      }

      let body: string | null = null;
      try { body = await req.text(); } catch {}

      const previousState = existing ? existing.currentState === 1 : false;
      const newState = true;
      if (newState !== previousState) {
        store.recordStateChange(adapterName, newState, "webhook");
      }
      store.upsertDevice({ name: adapterName, type: "adapter", state: newState });

      return new Response("ok");
    },
  });
}
