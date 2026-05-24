import { newMessageId } from "./message-id.js";

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

  constructor(
    private readonly transport: OutboundTransport,
    private readonly ctx: TurnContext,
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

  private async sendEvent(eventType: string, extra: Record<string, unknown>): Promise<void> {
    this.seq += 1;
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
  }
}
