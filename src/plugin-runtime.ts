import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let _runtime: PluginRuntime | undefined;

export function setRuntime(rt: PluginRuntime | undefined): void {
  _runtime = rt;
}

export function getRuntime(): PluginRuntime | undefined {
  return _runtime;
}
