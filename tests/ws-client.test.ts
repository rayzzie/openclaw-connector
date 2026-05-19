import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import type { ConnectorConfig } from "../src/config.js";
import { Logger } from "../src/logger.js";
import { GatewayWebSocketTransport } from "../src/ws-client.js";

let httpServer: Server | undefined;
let wsServer: WebSocketServer | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    wsServer?.close(() => resolve());
    if (!wsServer) {
      resolve();
    }
  });
  await new Promise<void>((resolve) => {
    httpServer?.close(() => resolve());
    if (!httpServer) {
      resolve();
    }
  });
  wsServer = undefined;
  httpServer = undefined;
});

describe("GatewayWebSocketTransport", () => {
  it("connects after connection.accepted and preserves base path", async () => {
    let requestedUrl = "";
    const baseUrl = await startWsServer((socket, requestUrl) => {
      requestedUrl = requestUrl;
      socket.send(JSON.stringify(connectionAccepted()));
    });
    const client = new GatewayWebSocketTransport(config(`${baseUrl}/api`), new Logger("error"));

    await client.connect("session_token");
    await client.close(1000, "test");

    expect(requestedUrl).toBe("/api/v1/agent-runtimes/connect");
  });

  it("rejects when connection.rejected is received", async () => {
    const baseUrl = await startWsServer((socket) => {
      socket.send(
        JSON.stringify({
          protocol_version: "uag.agent.v1",
          type: "connection.rejected",
          message_id: "msg_rejected",
          timestamp: "2026-05-19T10:00:00Z",
          payload: { error: { code: "unauthorized", message: "bad token" } }
        })
      );
    });
    const client = new GatewayWebSocketTransport(config(baseUrl), new Logger("error"));

    await expect(client.connect("bad")).rejects.toThrow("unauthorized");
  });

  it("emits replaced and closes when connection.replaced is received", async () => {
    const baseUrl = await startWsServer((socket) => {
      socket.send(JSON.stringify(connectionAccepted()));
      socket.send(
        JSON.stringify({
          protocol_version: "uag.agent.v1",
          type: "connection.replaced",
          message_id: "msg_replaced",
          timestamp: "2026-05-19T10:00:00Z",
          connection_id: "conn_001",
          agent_id: "agent_001",
          payload: { reason: "new_connection" }
        })
      );
    });
    const client = new GatewayWebSocketTransport(config(baseUrl), new Logger("error"));
    const replaced = new Promise((resolve) => {
      client.once("replaced", resolve);
    });

    await client.connect("session_token");

    await expect(replaced).resolves.toMatchObject({ type: "connection.replaced" });
  });

  it("ignores invalid json messages without throwing", async () => {
    const baseUrl = await startWsServer((socket) => {
      socket.send(JSON.stringify(connectionAccepted()));
      socket.send("{not-json");
    });
    const client = new GatewayWebSocketTransport(config(baseUrl), new Logger("error"));

    await client.connect("session_token");
    await client.close(1000, "test");

    expect(true).toBe(true);
  });
});

async function startWsServer(onConnection: (socket: WebSocket, requestUrl: string) => void): Promise<string> {
  httpServer = createServer();
  wsServer = new WebSocketServer({ server: httpServer });
  wsServer.on("connection", (socket, request) => {
    onConnection(socket, request.url ?? "");
  });
  await new Promise<void>((resolve) => httpServer?.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function config(gatewayBaseUrl: string): ConnectorConfig {
  return {
    gatewayBaseUrl,
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
}

function connectionAccepted(): object {
  return {
    protocol_version: "uag.agent.v1",
    type: "connection.accepted",
    message_id: "msg_accepted",
    timestamp: "2026-05-19T10:00:00Z",
    connection_id: "conn_001",
    agent_id: "agent_001",
    payload: { heartbeat_interval_sec: 20 }
  };
}
