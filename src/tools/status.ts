import type { Store } from "../store";
import type { PollerState } from "../poller";

export function getStatusHandler(store: Store, pollerState: PollerState) {
  const devices = store.listDevices();
  const adapters = devices.filter((d) => d.type === "adapter");
  const levers = devices.filter((d) => d.type === "lever");
  const watchers = store.listWatchers();
  const recentEvents = store.getRecentEvents(5);

  const status = {
    connected: pollerState.connected,
    devices: { total: devices.length, adapters: adapters.length, levers: levers.length },
    watchers: watchers.length,
    recentEvents,
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
}
