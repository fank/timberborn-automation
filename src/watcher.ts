import { WatcherRow, Store } from "./store";

export interface WatcherResult {
  watcherId: string;
  deviceName: string | null;
  message: string;
}

export function evaluateWatcher(
  watcher: WatcherRow,
  changedDevice: string,
  newState: boolean,
  previousState: boolean,
  store: Store
): WatcherResult | null {
  // If watcher targets a specific device, it must match the changed device
  if (watcher.deviceName !== null) {
    if (watcher.deviceName !== changedDevice) {
      return null;
    }
  } else if (watcher.groupName !== null) {
    // If watcher targets a group, changedDevice must be in that group
    const device = store.getDevice(changedDevice);
    if (device === null || device.groupName !== watcher.groupName) {
      return null;
    }
  }

  const condition = watcher.condition;

  switch (condition) {
    case "state_changed": {
      if (newState !== previousState) {
        return {
          watcherId: watcher.id,
          deviceName: watcher.deviceName ?? changedDevice,
          message: `${changedDevice} state changed to ${newState}`,
        };
      }
      return null;
    }

    case "state_true": {
      if (newState === true && previousState === false) {
        return {
          watcherId: watcher.id,
          deviceName: watcher.deviceName ?? changedDevice,
          message: `${changedDevice} state changed to true`,
        };
      }
      return null;
    }

    case "state_false": {
      if (newState === false && previousState === true) {
        return {
          watcherId: watcher.id,
          deviceName: watcher.deviceName ?? changedDevice,
          message: `${changedDevice} state changed to false`,
        };
      }
      return null;
    }

    case "all_false": {
      if (watcher.groupName === null) return null;
      const devices = store.listDevices({ group: watcher.groupName });
      if (devices.length === 0) return null;
      const allFalse = devices.every((d) => d.currentState === 0);
      if (allFalse) {
        return {
          watcherId: watcher.id,
          deviceName: null,
          message: `all devices in group "${watcher.groupName}" are false`,
        };
      }
      return null;
    }

    case "any_false": {
      if (watcher.groupName === null) return null;
      const devices = store.listDevices({ group: watcher.groupName });
      if (devices.length === 0) return null;
      const anyFalse = devices.some((d) => d.currentState === 0);
      if (anyFalse) {
        return {
          watcherId: watcher.id,
          deviceName: null,
          message: `at least one device in group "${watcher.groupName}" is false`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// Duration condition pattern: state_true_duration > Xm|h|s
const DURATION_PATTERN = /^state_(true|false)_duration\s*>\s*(\d+)(m|h|s)$/;

function parseDuration(value: number, unit: string): number {
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    default: return 0;
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function evaluateDurationWatchers(store: Store): WatcherResult[] {
  const watchers = store.getActiveWatchers();
  const results: WatcherResult[] = [];
  const now = Date.now();

  for (const watcher of watchers) {
    const match = DURATION_PATTERN.exec(watcher.condition);
    if (match === null) continue;

    const targetState = match[1] === "true";
    const thresholdMs = parseDuration(parseInt(match[2], 10), match[3]);

    // Determine which devices to check
    let deviceNames: string[] = [];
    if (watcher.deviceName !== null) {
      deviceNames = [watcher.deviceName];
    } else if (watcher.groupName !== null) {
      const devices = store.listDevices({ group: watcher.groupName });
      deviceNames = devices.map((d) => d.name);
    } else {
      continue;
    }

    for (const deviceName of deviceNames) {
      const device = store.getDevice(deviceName);
      if (device === null) continue;

      // Device must currently be in the target state
      const currentState = device.currentState === 1;
      if (currentState !== targetState) continue;

      // Find the most recent state change for this device
      const history = store.queryHistory({ name: deviceName, limit: 1 });
      if (history.length === 0) continue;

      // The last record should have state === targetState
      const lastChange = history[history.length - 1];
      if (lastChange.state !== (targetState ? 1 : 0)) continue;

      const lastChangedAt = new Date(lastChange.timestamp).getTime();
      const elapsed = now - lastChangedAt;

      if (elapsed >= thresholdMs) {
        const stateLabel = targetState ? "true" : "false";
        const durationLabel = formatDuration(elapsed);
        results.push({
          watcherId: watcher.id,
          deviceName,
          message: `${deviceName} has been ${stateLabel} for ${durationLabel}`,
        });
      }
    }
  }

  return results;
}
