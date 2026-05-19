import { describe, expect, it } from "vitest";

import type { ConnectorConfig } from "../src/config.js";
import { GatewayHttpClient, type FetchFn } from "../src/gateway-http-client.js";

const config: ConnectorConfig = {
  gatewayBaseUrl: "http://gateway",
  agentId: "agent_001",
  agentSk: "sk",
  endpointUrl: "http://connector/callback",
  agentVersion: "0.1.0",
  capabilities: ["text"],
  protocolVersion: "uag.agent.v1",
  connectRetryMinMs: 1000,
  connectRetryMaxMs: 30000,
  heartbeatIntervalSec: 20,
  ackDeadlineMs: 3000,
  ackMaxRetries: 2,
  mockMode: "happy",
  logLevel: "error"
};

describe("GatewayHttpClient", () => {
  it("registers an agent runtime", async () => {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (input, init) => {
      calls.push(`${init.method} ${input}`);
      return jsonResponse(200, { agent_id: "agent_001", session_token: "sess", ttl_sec: 60, registered_at: "now" });
    };
    const client = new GatewayHttpClient(config, fetchFn);

    const result = await client.register("agent_001", "sk", {
      version: "0.1.0",
      capabilities: ["text"],
      endpoint_url: "http://connector/callback"
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.session_token : "").toBe("sess");
    expect(calls).toEqual(["POST http://gateway/v1/agent-runtimes/register"]);
  });

  it("returns structured errors for 4xx register failures", async () => {
    const client = new GatewayHttpClient(config, async () =>
      jsonResponse(401, { error: { code: "unauthorized", message: "bad sk" } })
    );

    const result = await client.register("agent_001", "bad", {
      version: "0.1.0",
      capabilities: ["text"],
      endpoint_url: "http://connector/callback"
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({ status: 401, code: "unauthorized", message: "bad sk" });
  });

  it("returns structured errors for 5xx register failures", async () => {
    const client = new GatewayHttpClient(config, async () =>
      jsonResponse(503, { error: { code: "unavailable", message: "try later" } })
    );

    const result = await client.register("agent_001", "sk", {
      version: "0.1.0",
      capabilities: ["text"],
      endpoint_url: "http://connector/callback"
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.status).toBe(503);
  });

  it("sends heartbeat", async () => {
    const client = new GatewayHttpClient(config, async () => jsonResponse(200, { ok: true, next_heartbeat_in_sec: 30 }));

    const result = await client.heartbeat("sess", "agent_001", { active_sessions: 0 });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.next_heartbeat_in_sec : 0).toBe(30);
  });

  it("returns structured heartbeat auth errors", async () => {
    const client = new GatewayHttpClient(config, async () =>
      jsonResponse(401, { error: { code: "unauthorized", message: "expired" } })
    );

    const result = await client.heartbeat("expired", "agent_001", { active_sessions: 0 });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("unauthorized");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
