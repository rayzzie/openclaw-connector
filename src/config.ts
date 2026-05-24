import type { PluginConfig } from "./plugin-config.js";

export type ConnectorConfig = {
  gatewayBaseUrl: string;
  agentId: string;
  agentSk: string;
  agentVersion: string;
  capabilities: string[];
  protocolVersion: string;
  connectRetryMinMs: number;
  connectRetryMaxMs: number;
  heartbeatIntervalSec: number;
  ackDeadlineMs: number;
  ackMaxRetries: number;
};

export function configFromPlugin(pluginConfig: PluginConfig): ConnectorConfig {
  return {
    gatewayBaseUrl: pluginConfig.gatewayUrl,
    agentId: pluginConfig.agentId,
    agentSk: pluginConfig.agentSk,
    agentVersion: "1.0.0",
    capabilities: ["text", "speech"],
    protocolVersion: "uag.agent.v1",
    connectRetryMinMs: 1000,
    connectRetryMaxMs: 30000,
    heartbeatIntervalSec: 20,
    ackDeadlineMs: 3000,
    ackMaxRetries: 2,
  };
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}
