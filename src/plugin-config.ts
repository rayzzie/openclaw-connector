export type PluginConfig = {
  gatewayUrl: string;
  agentId: string;
  agentSk: string;
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
  };
}
