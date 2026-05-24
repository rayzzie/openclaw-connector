import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { AgentInterrupt, AgentRequest } from "./protocol.js";
import { buildSessionKey } from "./session-key.js";
import { OutboundHandler, type OutboundTransport } from "./outbound-handler.js";
import { newMessageId } from "./message-id.js";

export class InboundHandler {
  private readonly activeAborts = new Map<string, AbortController>();

  constructor(
    private readonly transport: OutboundTransport,
    private readonly rt: PluginRuntime,
    private readonly agentId: string,
  ) {}

  async handle(request: AgentRequest): Promise<void> {
    const inputs = request.payload["inputs"] as Array<{
      type?: string;
      text?: string;
      transcript?: string;
      image_url?: string;
    }> | undefined;
    const context = request.payload["context"] as Record<string, string> | undefined;
    const channel = request.payload["channel"] as string | undefined;

    const text = inputs?.[0]?.text ?? inputs?.[0]?.transcript ?? "";
    const phone = context?.["caller_phone"] ?? "";
    const imageUrl = inputs?.[0]?.image_url;

    const responseId = newMessageId("resp");
    const outbound = new OutboundHandler(this.transport, {
      agentId: this.agentId,
      sessionId: request.session_id,
      turnId: request.turn_id,
      requestId: request.request_id,
      traceId: request.trace_id,
      responseId,
    });

    const abortController = new AbortController();
    this.activeAborts.set(request.turn_id, abortController);

    const ctx: Record<string, unknown> = {
      SessionKey: buildSessionKey(phone),
      From: phone,
      To: this.agentId,
      ChatType: "direct",
      Provider: "uniagentgate",
      Surface: channel ?? "rcs",
      MessageSid: request.request_id,
      text,
    };
    if (imageUrl) {
      ctx["MediaPath"] = imageUrl;
    }

    await outbound.sendStarted();

    try {
      await this.rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx,
        dispatcherOptions: {
          deliver: async (payload: { text?: string }) => {
            if (payload.text) {
              await outbound.sendDelta(payload.text);
            }
          },
        },
        signal: abortController.signal,
      });
      await outbound.sendCompleted();
    } catch (err) {
      if (
        abortController.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        await outbound.sendInterrupted();
      } else {
        await outbound.sendFailed(err);
      }
    } finally {
      this.activeAborts.delete(request.turn_id);
    }
  }

  interrupt(interrupt: AgentInterrupt): void {
    this.activeAborts.get(interrupt.turn_id)?.abort();
  }
}
