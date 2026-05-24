import type { AckTracker } from "./ack-tracker.js";
import type { DedupeCache } from "./dedupe-cache.js";
import { newMessageId } from "./message-id.js";
import type { AgentInterrupt, AgentRequest, Envelope } from "./protocol.js";
import { validateAgentInterrupt, validateAgentRequest } from "./protocol.js";

export type RouterTransport = {
  send(message: object): Promise<void>;
  close(code: number, reason: string): Promise<void>;
};

export type EnvelopeRouterOptions = {
  transport: RouterTransport;
  ackTracker: AckTracker;
  dedupeCache: DedupeCache;
  onAgentRequest?: (message: AgentRequest) => Promise<void>;
  onAgentInterrupt?: (message: AgentInterrupt) => Promise<void>;
  dropAgentRequestAck?: boolean;
};

export class EnvelopeRouter {
  constructor(private readonly options: EnvelopeRouterOptions) {}

  async route(message: Partial<Envelope> & { type?: string; message_id?: string }): Promise<void> {
    if (message.type === "ack") {
      this.options.ackTracker.handleAck(message);
      return;
    }
    if (message.type === "connection.replaced") {
      await this.options.transport.close(4003, "connection_replaced");
      return;
    }
    if (message.type === "connection.accepted") {
      return;
    }
    if (message.type === "connection.rejected") {
      await this.options.transport.close(1008, "connection_rejected");
      return;
    }
    if (message.type === "ws.heartbeat") {
      await this.options.transport.send(this.heartbeatResponse());
      return;
    }
    if (message.type === "agent.request") {
      await this.routeAgentRequest(message);
      return;
    }
    if (message.type === "agent.interrupt") {
      await this.routeAgentInterrupt(message);
      return;
    }
    await this.protocolError("unknown_type", message.message_id);
  }

  private async routeAgentRequest(message: Partial<Envelope>): Promise<void> {
    const validated = validateAgentRequest(message);
    if (!validated.ok) {
      await this.protocolError(validated.error, message.message_id);
      return;
    }
    const ack = this.ackFor(validated.value.message_id);
    const cachedAck = this.options.dedupeCache.get(validated.value.message_id);
    if (cachedAck) {
      await this.options.transport.send(cachedAck);
      return;
    }
    if (validated.value.ack?.mode === "required" && !this.options.dropAgentRequestAck) {
      await this.options.transport.send(ack);
      this.options.dedupeCache.add(validated.value.message_id, ack);
    }
    await this.options.onAgentRequest?.(validated.value);
  }

  private async routeAgentInterrupt(message: Partial<Envelope>): Promise<void> {
    const validated = validateAgentInterrupt(message);
    if (!validated.ok) {
      await this.protocolError(validated.error, message.message_id);
      return;
    }
    const ack = this.ackFor(validated.value.message_id);
    const cachedAck = this.options.dedupeCache.get(validated.value.message_id);
    if (cachedAck) {
      await this.options.transport.send(cachedAck);
      return;
    }
    if ((validated.value as AgentInterrupt).ack?.mode === "required") {
      await this.options.transport.send(ack);
      this.options.dedupeCache.add(validated.value.message_id, ack);
    }
    await this.options.onAgentInterrupt?.(validated.value as AgentInterrupt);
  }

  private async protocolError(code: string, inReplyTo?: string): Promise<void> {
    await this.options.transport.send({
      protocol_version: "uag.agent.v1",
      type: "agent.error",
      message_id: newMessageId("msg_error"),
      timestamp: new Date().toISOString(),
      in_reply_to: inReplyTo,
      payload: { error: { code, message: code } }
    });
    await this.options.transport.close(4002, "protocol_error");
  }

  private ackFor(inReplyTo: string): object {
    return {
      protocol_version: "uag.agent.v1",
      type: "ack",
      message_id: newMessageId("msg_ack"),
      timestamp: new Date().toISOString(),
      in_reply_to: inReplyTo,
      payload: {}
    };
  }

  private heartbeatResponse(): object {
    return {
      protocol_version: "uag.agent.v1",
      type: "ws.heartbeat",
      message_id: newMessageId("msg_ws_heartbeat"),
      timestamp: new Date().toISOString(),
      payload: {}
    };
  }
}
