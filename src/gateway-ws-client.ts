import { EventEmitter } from "node:events";
import WebSocket, { type RawData } from "ws";

import type { ConnectorConfig } from "./config.js";
import type { Logger } from "./logger.js";
import {
  type ConnectionAccepted,
  type Envelope,
  validateConnectionAccepted,
  validateConnectionRejected,
  validateConnectionReplaced,
  validateEnvelope
} from "./protocol.js";

export type WsCloseEvent = {
  code: number;
  reason: string;
};

export type WsClientEvents = {
  message: [Envelope];
  close: [WsCloseEvent];
  replaced: [Envelope];
};

export class GatewayWebSocketTransport extends EventEmitter<WsClientEvents> {
  private socket: WebSocket | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatSequence = 0;
  private acceptedConnection: ConnectionAccepted | undefined;

  constructor(
    private readonly config: ConnectorConfig,
    private readonly logger: Logger
  ) {
    super();
  }

  connect(sessionToken: string): Promise<void> {
    const ws = new WebSocket(this.wsUrl(), {
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "X-Agent-Id": this.config.agentId,
        "X-UAG-Protocol-Version": this.config.protocolVersion
      }
    });
    this.socket = ws;

    return new Promise((resolve, reject) => {
      let accepted = false;
      let settled = false;

      ws.on("message", (data) => {
        const message = this.parseRawEnvelope(data);
        if (!message) {
          return;
        }

        const acceptedResult = validateConnectionAccepted(message);
        if (acceptedResult.ok) {
          accepted = true;
          settled = true;
          this.acceptedConnection = acceptedResult.value;
          this.startHeartbeat(acceptedResult.value);
          this.logger.info("websocket accepted", { connection_id: acceptedResult.value.connection_id });
          resolve();
          return;
        }

        const rejectedResult = validateConnectionRejected(message);
        if (rejectedResult.ok) {
          const error = rejectedResult.value.payload.error;
          const reason = `websocket rejected: ${error?.code || "unknown"} ${error?.message || ""}`.trim();
          void this.close(1008, reason);
          if (!settled) {
            settled = true;
            reject(new Error(reason));
          }
          return;
        }

        const replacedResult = validateConnectionReplaced(message);
        if (replacedResult.ok) {
          this.emit("replaced", replacedResult.value);
          void this.close(4003, "connection_replaced");
          return;
        }

        this.emit("message", message);
      });

      ws.on("close", (code, reasonBuffer) => {
        this.stopHeartbeat();
        const closeEvent = { code, reason: reasonBuffer.toString() };
        this.logger.warn("websocket closed", closeEvent);
        this.emit("close", closeEvent);
        if (!accepted && !settled) {
          settled = true;
          reject(new Error(`websocket closed before acceptance: ${code}`));
        }
      });

      ws.on("error", (error) => {
        this.stopHeartbeat();
        this.logger.error("websocket error", { error: error.message });
        if (!accepted && !settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  async send(message: object): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not open");
    }
    await new Promise<void>((resolve, reject) => {
      this.socket?.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  onMessage(handler: (message: Envelope) => void): void {
    this.on("message", handler);
  }

  async close(code: number, reason: string): Promise<void> {
    this.stopHeartbeat();
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise<void>((resolve) => {
      const socket = this.socket;
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      socket.once("close", () => resolve());
      socket.close(code, reason);
    });
  }

  private wsUrl(): string {
    const baseUrl = new URL(this.config.gatewayBaseUrl);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    baseUrl.pathname = `${basePath}/v1/agent-runtimes/connect`;
    baseUrl.search = "";
    return baseUrl.toString();
  }

  private startHeartbeat(accepted: ConnectionAccepted): void {
    this.stopHeartbeat();
    const intervalMs = accepted.payload.heartbeat_interval_sec * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      this.heartbeatSequence += 1;
      void this.send({
        protocol_version: this.config.protocolVersion,
        type: "ws.heartbeat",
        message_id: `msg_ws_heartbeat_${Date.now()}_${this.heartbeatSequence}`,
        timestamp: new Date().toISOString(),
        connection_id: accepted.connection_id,
        agent_id: this.config.agentId,
        payload: {}
      });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private parseRawEnvelope(data: RawData): Envelope | undefined {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : data.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn("websocket message ignored: invalid json");
      return undefined;
    }
    const envelope = validateEnvelope(parsed);
    if (!envelope.ok) {
      this.logger.warn("websocket message ignored: invalid envelope", { error: envelope.error });
      return undefined;
    }
    return envelope.value;
  }
}
