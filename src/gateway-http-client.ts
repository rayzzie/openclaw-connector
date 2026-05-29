import type {
  HeartbeatResponse,
  RegisterRuntimeResponse,
  RuntimeGatewayClient,
} from "./runtime.js";

/**
 * HTTP client for the uniAgentGate gateway register/heartbeat endpoints.
 *
 * `fetchImpl` is injectable so tests can supply a mock without touching the
 * global. The returned object conforms to `RuntimeGatewayClient`, the shape
 * `ConnectorRuntime` consumes.
 */
export function makeGatewayClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): RuntimeGatewayClient {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async register(agentId, sk, payload) {
      try {
        const res = await fetchImpl(`${base}/v1/agent-runtimes/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sk}`,
            "X-Agent-Id": agentId,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: { status: res.status, code: "http_error", message: text } };
        }
        return { ok: true, value: (await res.json()) as RegisterRuntimeResponse };
      } catch (err) {
        return { ok: false, error: { status: 0, code: "network_error", message: String(err) } };
      }
    },

    async heartbeat(sessionToken, agentId, load) {
      try {
        const res = await fetchImpl(`${base}/v1/agent-runtimes/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
            "X-Agent-Id": agentId,
          },
          body: JSON.stringify(load),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: { status: res.status, code: "http_error", message: text } };
        }
        return { ok: true, value: (await res.json()) as HeartbeatResponse };
      } catch (err) {
        return { ok: false, error: { status: 0, code: "network_error", message: String(err) } };
      }
    },
  };
}
