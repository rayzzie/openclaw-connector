import type { ConnectorConfig } from "./config.js";

export type RegisterRuntimePayload = {
  version: string;
  capabilities: string[];
  endpoint_url: string;
};

export type RegisterRuntimeResponse = {
  agent_id: string;
  session_token: string;
  ttl_sec: number;
  registered_at: string;
};

export type HeartbeatResponse = {
  ok: boolean;
  next_heartbeat_in_sec: number;
};

export type AgentLoad = {
  active_sessions: number;
};

export type GatewayError = {
  status: number;
  code: string;
  message: string;
};

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; error: GatewayError };

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export class GatewayHttpClient {
  constructor(
    private readonly config: ConnectorConfig,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  async register(agentId: string, sk: string, payload: RegisterRuntimePayload): Promise<GatewayResult<RegisterRuntimeResponse>> {
    const response = await this.fetchFn(`${this.config.gatewayBaseUrl}/v1/agent-runtimes/register`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sk}`,
        "Content-Type": "application/json",
        "X-Agent-Id": agentId
      },
      body: JSON.stringify(payload)
    });
    return this.parseJson<RegisterRuntimeResponse>(response, "register_failed");
  }

  async heartbeat(sessionToken: string, agentId: string, load: AgentLoad): Promise<GatewayResult<HeartbeatResponse>> {
    const response = await this.fetchFn(`${this.config.gatewayBaseUrl}/v1/agent-runtimes/heartbeat`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: agentId,
        load
      })
    });
    return this.parseJson<HeartbeatResponse>(response, "heartbeat_failed");
  }

  private async parseJson<T>(response: Response, fallbackCode: string): Promise<GatewayResult<T>> {
    const text = await response.text();
    const parsed = parseBody(text);
    if (!response.ok) {
      return {
        ok: false,
        error: {
          status: response.status,
          code: extractErrorCode(parsed, fallbackCode),
          message: extractErrorMessage(parsed, text || response.statusText)
        }
      };
    }
    if (!parsed.ok) {
      return {
        ok: false,
        error: {
          status: response.status,
          code: "invalid_json",
          message: parsed.error
        }
      };
    }
    return { ok: true, value: parsed.value as T };
  }
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, error: "response body is not valid json" };
  }
}

function extractErrorCode(parsed: { ok: true; value: unknown } | { ok: false; error: string }, fallback: string): string {
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return fallback;
  }
  const root = parsed.value as { error?: { code?: unknown } };
  return typeof root.error?.code === "string" ? root.error.code : fallback;
}

function extractErrorMessage(parsed: { ok: true; value: unknown } | { ok: false; error: string }, fallback: string): string {
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return fallback;
  }
  const root = parsed.value as { error?: { message?: unknown } };
  return typeof root.error?.message === "string" ? root.error.message : fallback;
}
