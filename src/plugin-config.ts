export type PluginConfig = {
  gatewayUrl: string;
  agentId: string;
  agentSk: string;
  desktopFrameProvider: "screen" | "fake";
  desktopFrameFps: number;
  desktopFrameTtlMs: number;
};

export function resolvePluginConfig(raw: unknown): PluginConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Plugin config must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const { gatewayUrl, agentId, agentSk } = obj;

  if (typeof gatewayUrl !== "string" || !gatewayUrl) {
    throw new Error("Plugin config: gatewayUrl is required");
  }
  if (typeof agentId !== "string" || !agentId) {
    throw new Error("Plugin config: agentId is required");
  }
  if (typeof agentSk !== "string" || !agentSk) {
    throw new Error("Plugin config: agentSk is required");
  }

  return {
    gatewayUrl: gatewayUrl.replace(/\/+$/, ""),
    agentId,
    agentSk,
    desktopFrameProvider: readDesktopFrameProvider(obj["desktopFrameProvider"]),
    desktopFrameFps: readPositiveNumber(obj["desktopFrameFps"], 1),
    desktopFrameTtlMs: readPositiveNumber(obj["desktopFrameTtlMs"], 2000),
  };
}

export function resolveRuntimePluginConfig(pluginConfig: unknown, openclawConfig: unknown): PluginConfig {
  if (hasPluginConfig(pluginConfig)) {
    return resolvePluginConfig(pluginConfig);
  }
  const channelConfig = readUniagentGateChannelConfig(openclawConfig);
  if (hasPluginConfig(channelConfig)) {
    return resolvePluginConfig(channelConfig);
  }
  return resolvePluginConfig(pluginConfig);
}

function readUniagentGateChannelConfig(openclawConfig: unknown): unknown {
  if (!isRecord(openclawConfig)) {
    return undefined;
  }
  const channels = openclawConfig["channels"];
  if (!isRecord(channels)) {
    return undefined;
  }
  return channels["uniagentgate"];
}

function hasPluginConfig(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["gatewayUrl"] === "string" &&
    value["gatewayUrl"].length > 0 &&
    typeof value["agentId"] === "string" &&
    value["agentId"].length > 0 &&
    typeof value["agentSk"] === "string" &&
    value["agentSk"].length > 0
  );
}

function readDesktopFrameProvider(value: unknown): "screen" | "fake" {
  return value === "screen" ? "screen" : "fake";
}

function readPositiveNumber(value: unknown, defaultValue: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaultValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
