import type { Store } from "../store";

export function listDevicesHandler(store: Store, args: Record<string, unknown>) {
  const type = args.type as string | undefined;
  const group = args.group as string | undefined;
  const includeDisappeared = args.include_disappeared as boolean | undefined;
  const devices = store.listDevices({ type, group, includeDisappeared: includeDisappeared ?? false });
  return { content: [{ type: "text" as const, text: JSON.stringify(devices, null, 2) }] };
}

export function getDeviceHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string;
  const device = store.getDevice(name);
  if (!device) {
    return { content: [{ type: "text" as const, text: `Device not found: ${name}` }], isError: true };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(device, null, 2) }] };
}

export function removeDeviceHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string;
  const device = store.getDevice(name);
  if (!device) {
    return { content: [{ type: "text" as const, text: `Device not found: ${name}` }], isError: true };
  }
  store.removeDevice(name);
  return { content: [{ type: "text" as const, text: `Removed device: ${name}` }] };
}

export function annotateDeviceHandler(store: Store, args: Record<string, unknown>) {
  const name = args.name as string;
  const label = (args.label as string) ?? null;
  const group = (args.group as string) ?? null;
  const device = store.getDevice(name);
  if (!device) {
    return { content: [{ type: "text" as const, text: `Device not found: ${name}` }], isError: true };
  }
  store.annotateDevice(name, label ?? device.label, group ?? device.groupName);
  return { content: [{ type: "text" as const, text: `Updated ${name}` }] };
}
