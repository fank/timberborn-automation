import type { Store } from "../store";
import type { TimberbornClient } from "../timberborn";

export async function switchLeverHandler(store: Store, client: TimberbornClient, args: Record<string, unknown>) {
  const name = args.name as string;
  const action = args.action as "on" | "off" | "color";
  const value = args.value as string | undefined;

  let success = false;
  if (action === "on") success = await client.switchOn(name);
  else if (action === "off") success = await client.switchOff(name);
  else if (action === "color" && value) success = await client.setColor(name, value);

  const dbAction = action === "on" ? "switch-on" : action === "off" ? "switch-off" : "color";
  store.logCommand(name, dbAction, value ?? null, success);

  if (!success) {
    return { content: [{ type: "text" as const, text: `Failed to ${action} lever: ${name}` }], isError: true };
  }
  return { content: [{ type: "text" as const, text: `Lever ${name}: ${action}${value ? ` (${value})` : ""} — success` }] };
}
