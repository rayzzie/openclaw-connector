export type ConnectorConfig = {
  gatewayBaseUrl: string;
  agentId: string;
  agentSk: string;
  endpointUrl: string;
  agentVersion: string;
  capabilities: string[];
  protocolVersion: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function loadConfig(): ConnectorConfig {
  return {
    gatewayBaseUrl: optionalEnv("UAG_GATEWAY_BASE_URL", "http://127.0.0.1:8080").replace(/\/+$/, ""),
    agentId: requiredEnv("UAG_AGENT_ID"),
    agentSk: requiredEnv("UAG_AGENT_SK"),
    endpointUrl: optionalEnv("UAG_ENDPOINT_URL", "http://127.0.0.1:18081/callback"),
    agentVersion: optionalEnv("UAG_AGENT_VERSION", "0.1.0"),
    capabilities: optionalEnv("UAG_CAPABILITIES", "text,speech")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    protocolVersion: optionalEnv("UAG_PROTOCOL_VERSION", "uag.agent.v1")
  };
}
