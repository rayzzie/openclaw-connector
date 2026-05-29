import type { Logger } from "./logger.js";
import { newMessageId } from "./message-id.js";
import type { VisualFramePayload } from "./protocol.js";

export type OutboundTransport = {
  send(message: object): Promise<void>;
};

export type TurnContext = {
  agentId: string;
  sessionId: string;
  turnId: string;
  requestId: string;
  traceId: string;
  responseId: string;
};

export class OutboundHandler {
  private seq = 0;
  private transportLost = false;

  constructor(
    private readonly transport: OutboundTransport,
    private readonly ctx: TurnContext,
    private readonly logger?: Logger,
  ) {}

  async sendStarted(): Promise<void> {
    await this.sendEvent("response.started", {});
  }

  async sendDelta(text: string): Promise<void> {
    await this.sendEvent("output.delta", { kind: "text", text, text_delta: text });
  }

  async sendCompleted(): Promise<void> {
    await this.sendEvent("response.completed", {});
  }

  async sendInterrupted(): Promise<void> {
    await this.sendEvent("response.interrupted", {});
  }

  async sendFailed(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.sendEvent("response.failed", { error: { message } });
  }

  async sendVisualSurfaceSelect(surface: string, reason?: string): Promise<void> {
    await this.sendEvent("visual.surface.select", reason ? { surface, reason } : { surface });
  }

  async sendVisualFrame(payload: VisualFramePayload): Promise<void> {
    const { type, ...extra } = payload;
    await this.sendEvent(type, extra);
  }

  get hasLostTransport(): boolean {
    return this.transportLost;
  }

  private async sendEvent(eventType: string, extra: Record<string, unknown>): Promise<void> {
    if (this.transportLost) {
      this.logger?.warn("outbound dropped — transport already lost", {
        event_type: eventType,
        request_id: this.ctx.requestId,
      });
      return;
    }
    this.seq += 1;
    try {
      await this.transport.send({
        protocol_version: "uag.agent.v1",
        type: "agent.event",
        message_id: newMessageId("msg_evt"),
        timestamp: new Date().toISOString(),
        agent_id: this.ctx.agentId,
        session_id: this.ctx.sessionId,
        turn_id: this.ctx.turnId,
        request_id: this.ctx.requestId,
        response_id: this.ctx.responseId,
        trace_id: this.ctx.traceId,
        sequence: this.seq,
        payload: { type: eventType, ...extra },
      });
    } catch (err) {
      this.transportLost = true;
      this.logger?.warn("outbound dropped — transport unavailable", {
        event_type: eventType,
        request_id: this.ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
