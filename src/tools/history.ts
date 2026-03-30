import type { Store } from "../store";

export function queryHistoryHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string | undefined;
  const group = args.group as string | undefined;
  const since = args.since as string | undefined;
  const until = args.until as string | undefined;
  const limit = args.limit as number | undefined;
  const history = store.queryHistory({ name, group, since, until, limit: limit ?? 100 });
  return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
}
