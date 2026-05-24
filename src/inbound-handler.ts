import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { AgentInterrupt, AgentRequest } from "./protocol.js";
import { buildSessionKey } from "./session-key.js";
import { OutboundHandler, type OutboundTransport } from "./outbound-handler.js";
import { newMessageId } from "./message-id.js";

type RequestInput = {
  type?: string;
  text?: string;
  transcript?: string;
  image_url?: string;
  url?: string;
};

export class InboundHandler {
  private readonly activeAborts = new Map<string, AbortController>();

  constructor(
    private readonly transport: OutboundTransport,
    private readonly rt: PluginRuntime,
    private readonly agentId: string,
  ) {}

  async handle(request: AgentRequest): Promise<void> {
    const inputs = parseInputs(request.payload["inputs"]);
    const context = parseStringRecord(request.payload["context"]);
    const metadata = parseStringRecord(request.payload["metadata"]);
    const payloadChannel = stringValue(request.payload["channel"]);
    const requestChannel = request.channel;

    const text = firstText(inputs);
    const phone =
      stringValue(context?.["caller_phone"]) ??
      stringValue(requestChannel?.phone_number) ??
      stringValue(requestChannel?.external_session_id) ??
      "";
    const imageUrl = firstMediaUrl(inputs) ?? stringValue(metadata?.["file_url"]);
    const surface = stringValue(requestChannel?.type) ?? payloadChannel ?? "rcs";

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
      Body: text,
      BodyForAgent: text,
      CommandBody: text,
      RawBody: text,
      SessionKey: buildSessionKey(phone),
      From: phone,
      To: this.agentId,
      AccountId: "default",
      ChatType: "direct",
      Provider: "uniagentgate",
      Surface: surface,
      MessageSid: request.request_id,
      Timestamp: Date.now(),
      OriginatingChannel: surface,
      OriginatingTo: phone,
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

function parseInputs(value: unknown): RequestInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((item) => ({
    type: stringValue(item["type"]),
    text: stringValue(item["text"]),
    transcript: stringValue(item["transcript"]),
    image_url: stringValue(item["image_url"]),
    url: stringValue(item["url"]),
  }));
}

function firstText(inputs: RequestInput[]): string {
  for (const input of inputs) {
    const text = input.text ?? input.transcript;
    if (text) {
      return text;
    }
  }
  return "";
}

function firstMediaUrl(inputs: RequestInput[]): string | undefined {
  for (const input of inputs) {
    if (input.image_url) {
      return input.image_url;
    }
    if (input.type === "file_url" && input.url) {
      return input.url;
    }
  }
  return undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    if (typeof recordValue === "string") {
      out[key] = recordValue;
    }
  }
  return out;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
