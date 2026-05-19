import type { ConnectorConfig } from "./config.js";
import type { AgentLoad, HeartbeatResponse, RegisterRuntimeResponse } from "./types.js";

export class GatewayHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
  }
}

export class GatewayClient {
  constructor(private readonly config: ConnectorConfig) {}

  async registerRuntime(): Promise<RegisterRuntimeResponse> {
    const response = await fetch(`${this.config.gatewayBaseUrl}/v1/agent-runtimes/register`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.agentSk}`,
        "Content-Type": "application/json",
        "X-Agent-Id": this.config.agentId
      },
      body: JSON.stringify({
        version: this.config.agentVersion,
        capabilities: this.config.capabilities,
        endpoint_url: this.config.endpointUrl
      })
    });
    return this.parseJson<RegisterRuntimeResponse>(response, "register runtime");
  }

  async heartbeat(sessionToken: string, load: AgentLoad = { active_sessions: 0 }): Promise<HeartbeatResponse> {
    const response = await fetch(`${this.config.gatewayBaseUrl}/v1/agent-runtimes/heartbeat`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: this.config.agentId,
        load
      })
    });
    return this.parseJson<HeartbeatResponse>(response, "heartbeat");
  }

  private async parseJson<T>(response: Response, operation: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new GatewayHttpError(`Gateway ${operation} failed`, response.status, text);
    }
    return JSON.parse(text) as T;
  }
}
