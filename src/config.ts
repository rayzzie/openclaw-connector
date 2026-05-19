export type ConnectorConfig = {
  gatewayBaseUrl: string;
  agentId: string;
  agentSk: string;
  endpointUrl: string;
  agentVersion: string;
  capabilities: string[];
  protocolVersion: string;
  connectRetryMinMs: number;
  connectRetryMaxMs: number;
  heartbeatIntervalSec: number;
  ackDeadlineMs: number;
  ackMaxRetries: number;
  mockMode: string;
  logLevel: string;
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

function optionalIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return parsed;
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
    protocolVersion: optionalEnv("UAG_PROTOCOL_VERSION", "uag.agent.v1"),
    connectRetryMinMs: optionalIntEnv("UAG_CONNECT_RETRY_MIN_MS", 1000),
    connectRetryMaxMs: optionalIntEnv("UAG_CONNECT_RETRY_MAX_MS", 30000),
    heartbeatIntervalSec: optionalIntEnv("UAG_HEARTBEAT_INTERVAL_SEC", 20),
    ackDeadlineMs: optionalIntEnv("UAG_ACK_DEADLINE_MS", 3000),
    ackMaxRetries: optionalIntEnv("UAG_ACK_MAX_RETRIES", 2),
    mockMode: optionalEnv("MOCK_MODE", "happy"),
    logLevel: optionalEnv("LOG_LEVEL", "info")
  };
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}
