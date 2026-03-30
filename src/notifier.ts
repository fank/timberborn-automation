import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Store } from "./store";

export class Notifier {
  constructor(
    private server: Server,
    private store: Store
  ) {}

  async notify(event: {
    watcherId?: string | null;
    type: string;
    deviceName?: string | null;
    message: string;
  }) {
    this.store.logEvent({
      watcherId: event.watcherId ?? null,
      type: event.type,
      deviceName: event.deviceName ?? null,
      message: event.message,
    });

    const meta: Record<string, string> = { type: event.type };
    if (event.deviceName) meta.device = event.deviceName;
    if (event.watcherId) meta.watcher_id = event.watcherId;

    await this.server.notification({
      method: "notifications/claude/channel",
      params: { content: event.message, meta },
    });
  }
}
