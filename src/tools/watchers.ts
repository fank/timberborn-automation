import type { Store } from "../store";

export function createWatcherHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  const deviceName = (args.device_name as string) ?? null;
  const groupName = (args.group_name as string) ?? null;
  const condition = args.condition as string;
  store.createWatcher({ id, deviceName, groupName, condition });
  return { content: [{ type: "text" as const, text: `Watcher '${id}' created: ${condition}` }] };
}

export function listWatchersHandler(store: Store) {
  const watchers = store.listWatchers();
  return { content: [{ type: "text" as const, text: JSON.stringify(watchers, null, 2) }] };
}

export function deleteWatcherHandler(store: Store, args: Record<string, unknown>) {
  const id = args.id as string;
  store.deleteWatcher(id);
  return { content: [{ type: "text" as const, text: `Watcher '${id}' deleted` }] };
}
