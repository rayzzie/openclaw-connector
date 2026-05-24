import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { ConnectorConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import {
  ConnectorRuntime,
  heartbeatIntervalSec,
  type AgentLoad,
  type GatewayResult,
  type HeartbeatResponse,
  type RegisterRuntimePayload,
  type RegisterRuntimeResponse,
  type RuntimeGatewayClient,
  type RuntimeTransport,
} from "../src/runtime.js";
import type { WsCloseEvent } from "../src/gateway-ws-client.js";

const config: ConnectorConfig = {
  gatewayBaseUrl: "http://gateway",
  agentId: "agent_001",
  agentSk: "sk",
  agentVersion: "0.1.0",
  capabilities: ["text"],
  protocolVersion: "uag.agent.v1",
  connectRetryMinMs: 1,
  connectRetryMaxMs: 2,
  heartbeatIntervalSec: 20,
  ackDeadlineMs: 3000,
  ackMaxRetries: 2,
};

describe("ConnectorRuntime", () => {
  it("uses min(configured heartbeat, ttl/2)", () => {
    expect(heartbeatIntervalSec(20, 60)).toBe(20);
    expect(heartbeatIntervalSec(40, 60)).toBe(30);
  });

  it("retries 5xx register failures three times then exits", async () => {
    const client = new FakeClient([
      errorResult(503, "unavailable"),
      errorResult(503, "unavailable"),
      errorResult(503, "unavailable")
    ]);
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), { sleep: async () => undefined });

    await runtime.start();

    expect(client.registerCalls).toBe(3);
  });

  it("re-registers after three heartbeat failures", async () => {
    const client = new FakeClient(
      [registerResult("token_1"), errorResult(401, "bad_sk")],
      [errorResult(503, "unavailable"), errorResult(503, "unavailable"), errorResult(503, "unavailable")]
    );
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), {
      sleep: async () => undefined,
      transportFactory: () => new RejectingTransport()
    });

    await runtime.start();

    expect(client.registerCalls).toBe(2);
    expect(client.heartbeatCalls).toBe(3);
  });

  it("re-registers when heartbeat returns 401", async () => {
    const client = new FakeClient([registerResult("token_1"), errorResult(401, "bad_sk")], [errorResult(401, "expired")]);
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), {
      sleep: async () => undefined,
      transportFactory: () => new RejectingTransport()
    });

    await runtime.start();

    expect(client.registerCalls).toBe(2);
    expect(client.heartbeatCalls).toBe(1);
  });

  it("stops cleanly", async () => {
    const client = new FakeClient([registerResult("token_1")]);
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), { sleep: async () => undefined });

    await runtime.stop("test");

    expect(client.registerCalls).toBe(0);
  });

  it("does not re-register after connection_replaced", async () => {
    const client = new FakeClient([registerResult("token_1")]);
    const transport = new ClosingTransport({ code: 4003, reason: "connection_replaced" });
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), {
      sleep: async () => undefined,
      transportFactory: () => transport
    });

    await runtime.start();

    expect(client.registerCalls).toBe(1);
  });

  it("accepts onAgentRequest and onAgentInterrupt in options", () => {
    const client = new FakeClient([]);
    const runtime = new ConnectorRuntime(config, client, new Logger("error"), {
      sleep: async () => undefined,
      onAgentRequest: async (_msg) => {},
      onAgentInterrupt: async (_msg) => {},
    });
    // Just verifies the constructor accepts these options without error
    expect(runtime).toBeDefined();
  });
});

class FakeClient implements RuntimeGatewayClient {
  registerCalls = 0;
  heartbeatCalls = 0;

  constructor(
    private readonly registerResults: GatewayResult<RegisterRuntimeResponse>[],
    private readonly heartbeatResults: GatewayResult<HeartbeatResponse>[] = []
  ) {}

  async register(_agentId: string, _sk: string, _payload: RegisterRuntimePayload): Promise<GatewayResult<RegisterRuntimeResponse>> {
    this.registerCalls += 1;
    return this.registerResults.shift() ?? errorResult(401, "done");
  }

  async heartbeat(_sessionToken: string, _agentId: string, _load: AgentLoad): Promise<GatewayResult<HeartbeatResponse>> {
    this.heartbeatCalls += 1;
    return this.heartbeatResults.shift() ?? errorResult(503, "unavailable");
  }
}

class RejectingTransport extends EventEmitter implements RuntimeTransport {
  async connect(_sessionToken: string): Promise<void> {
    throw new Error("ws unavailable");
  }

  async close(_code: number, _reason: string): Promise<void> {
    this.emit("close", { code: 1000, reason: "closed" } satisfies WsCloseEvent);
  }
}

class ClosingTransport extends EventEmitter implements RuntimeTransport {
  constructor(private readonly closeEvent: WsCloseEvent) {
    super();
  }

  async connect(_sessionToken: string): Promise<void> {
    queueMicrotask(() => this.emit("close", this.closeEvent));
  }

  async send(_message: object): Promise<void> {}

  onMessage(_handler: () => void): void {}

  async close(_code: number, _reason: string): Promise<void> {
    this.emit("close", this.closeEvent);
  }
}

function registerResult(sessionToken: string): GatewayResult<RegisterRuntimeResponse> {
  return {
    ok: true,
    value: {
      session_token: sessionToken,
      ttl_sec: 60,
    }
  };
}

function errorResult<T>(status: number, code: string): GatewayResult<T> {
  return { ok: false, error: { status, code, message: code } };
}
