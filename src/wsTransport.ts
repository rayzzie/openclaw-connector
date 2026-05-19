import WebSocket, { type RawData } from "ws";

import type { ConnectorConfig } from "./config.js";
import type { Logger } from "./logger.js";

type ConnectionAccepted = {
  type: "connection.accepted";
  connection_id: string;
  payload: {
    heartbeat_interval_sec: number;
  };
};

type ConnectionRejected = {
  type: "connection.rejected";
  payload: {
    error?: {
      code?: string;
      message?: string;
    };
  };
};

type GatewayEnvelope = ConnectionAccepted | ConnectionRejected | { type: string; [key: string]: unknown };

export class GatewayWebSocketTransport {
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private heartbeatSequence = 0;

  constructor(
    private readonly config: ConnectorConfig,
    private readonly logger: Logger
  ) {}

  connect(sessionToken: string): Promise<void> {
    const ws = new WebSocket(this.wsUrl(), {
      headers: {
        "Authorization": `Bearer ${sessionToken}`,
        "X-Agent-Id": this.config.agentId,
        "X-UAG-Protocol-Version": this.config.protocolVersion
      }
    });

    return new Promise((resolve, reject) => {
      let accepted = false;

      ws.on("message", (data) => {
        const message = this.parseEnvelope(data);
        if (this.isConnectionAccepted(message)) {
          accepted = true;
          this.startHeartbeat(ws, message);
          this.logger.info("websocket accepted", { connection_id: message.connection_id });
          resolve();
          return;
        }
        if (this.isConnectionRejected(message)) {
          const error = message.payload.error;
          reject(new Error(`websocket rejected: ${error?.code || "unknown"} ${error?.message || ""}`.trim()));
          return;
        }
        this.logger.debug("websocket message received", { type: message.type });
      });

      ws.on("close", (code, reason) => {
        this.stopHeartbeat();
        this.logger.warn("websocket closed", { code, reason: reason.toString() });
        if (!accepted) {
          reject(new Error(`websocket closed before acceptance: ${code}`));
        }
      });

      ws.on("error", (error) => {
        this.stopHeartbeat();
        if (!accepted) {
          reject(error);
        }
      });
    });
  }

  private wsUrl(): string {
    const baseUrl = new URL(this.config.gatewayBaseUrl);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    baseUrl.pathname = "/v1/agent-runtimes/connect";
    baseUrl.search = "";
    return baseUrl.toString();
  }

  private startHeartbeat(ws: WebSocket, accepted: ConnectionAccepted): void {
    this.stopHeartbeat();
    const intervalMs = accepted.payload.heartbeat_interval_sec * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.heartbeatSequence += 1;
      ws.send(
        JSON.stringify({
          protocol_version: this.config.protocolVersion,
          type: "ws.heartbeat",
          message_id: `msg_ws_heartbeat_${Date.now()}_${this.heartbeatSequence}`,
          timestamp: new Date().toISOString(),
          connection_id: accepted.connection_id,
          agent_id: this.config.agentId,
          payload: {}
        })
      );
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private parseEnvelope(data: RawData): GatewayEnvelope {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : data.toString();
    return JSON.parse(text) as GatewayEnvelope;
  }

  private isConnectionAccepted(message: GatewayEnvelope): message is ConnectionAccepted {
    return (
      message.type === "connection.accepted" &&
      typeof (message as ConnectionAccepted).connection_id === "string" &&
      typeof (message as ConnectionAccepted).payload?.heartbeat_interval_sec === "number"
    );
  }

  private isConnectionRejected(message: GatewayEnvelope): message is ConnectionRejected {
    return message.type === "connection.rejected" && typeof message.payload === "object" && message.payload !== null;
  }
}
