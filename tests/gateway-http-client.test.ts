import { describe, it, expect, vi } from "vitest";

import { makeGatewayClient } from "../src/gateway-http-client.js";
import type { AgentLoad, RegisterRuntimePayload } from "../src/runtime.js";

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => text,
  } as unknown as Response;
}

const payload: RegisterRuntimePayload = { version: "0.1.0", capabilities: ["text"] };
const load: AgentLoad = { active_sessions: 0 };

describe("makeGatewayClient.register", () => {
  it("returns ok with parsed body on 2xx and sends auth headers", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ session_token: "tok", ttl_sec: 45 }));
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.register("agent_1", "sk_secret", payload);

    expect(result).toEqual({ ok: true, value: { session_token: "tok", ttl_sec: 45 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe("http://gw:18080/v1/agent-runtimes/register");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_secret");
    expect(init.headers["X-Agent-Id"]).toBe("agent_1");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ session_token: "t", ttl_sec: 1 }));
    const client = makeGatewayClient("http://gw:18080///", fetchImpl as unknown as typeof fetch);

    await client.register("a", "s", payload);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://gw:18080/v1/agent-runtimes/register");
  });

  it("maps non-2xx to http_error with status and body text", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400, "bad request"));
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.register("a", "s", payload);

    expect(result).toEqual({ ok: false, error: { status: 400, code: "http_error", message: "bad request" } });
  });

  it("maps thrown errors to network_error with status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.register("a", "s", payload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(0);
      expect(result.error.code).toBe("network_error");
      expect(result.error.message).toContain("boom");
    }
  });
});

describe("makeGatewayClient.heartbeat", () => {
  it("returns ok with parsed body on 2xx using the session token", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ next_heartbeat_in_sec: 20 }));
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.heartbeat("session_tok", "agent_1", load);

    expect(result).toEqual({ ok: true, value: { next_heartbeat_in_sec: 20 } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe("http://gw:18080/v1/agent-runtimes/heartbeat");
    expect(init.headers.Authorization).toBe("Bearer session_tok");
    expect(init.headers["X-Agent-Id"]).toBe("agent_1");
    expect(JSON.parse(init.body)).toEqual(load);
  });

  it("maps non-2xx to http_error", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401, "unauthorized"));
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.heartbeat("t", "a", load);

    expect(result).toEqual({ ok: false, error: { status: 401, code: "http_error", message: "unauthorized" } });
  });

  it("maps thrown errors to network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("neterr");
    });
    const client = makeGatewayClient("http://gw:18080", fetchImpl as unknown as typeof fetch);

    const result = await client.heartbeat("t", "a", load);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("network_error");
    }
  });
});
