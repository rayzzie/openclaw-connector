import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { AgentInterrupt, AgentRequest } from "./protocol.js";
import { buildSessionKey } from "./session-key.js";
import { OutboundHandler, type OutboundTransport } from "./outbound-handler.js";
import {
  resolveOutboundMediaUrls,
  type OutboundReplyPayload,
} from "./outbound-reply-payload.js";
import { resolveMediaRefToUrl, type ResolveMediaDeps } from "./outbound-media.js";
import { newMessageId } from "./message-id.js";
import type { Logger } from "./logger.js";

type RequestInput = {
  type?: string;
  text?: string;
  transcript?: string;
  mime_type?: string;
  data_base64?: string;
  image_url?: string;
  url?: string;
};

export class InboundHandler {
  private readonly activeAborts = new Map<string, AbortController>();

  constructor(
    private readonly transport: OutboundTransport,
    private readonly rt: PluginRuntime,
    private readonly agentId: string,
    private readonly logger?: Logger,
    private readonly cfg?: unknown,
    private readonly mediaDeps: ResolveMediaDeps = {},
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
    const inlineImage = firstInlineImage(inputs);
    const surface = stringValue(requestChannel?.type) ?? payloadChannel ?? "rcs";

    this.logger?.info("agent.request received", {
      request_id: request.request_id,
      session_id: request.session_id,
      input_len: text.length,
      phone_suffix: phone.slice(-4),
      surface,
    });

    const responseId = newMessageId("resp");
    const outbound = new OutboundHandler(
      this.transport,
      {
        agentId: this.agentId,
        sessionId: request.session_id,
        turnId: request.turn_id,
        requestId: request.request_id,
        traceId: request.trace_id,
        responseId,
      },
      this.logger,
    );

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
    if (inlineImage) {
      ctx["MediaMimeType"] = inlineImage.mimeType;
      ctx["MediaBase64"] = inlineImage.dataBase64;
      ctx["MediaDataUrl"] = `data:${inlineImage.mimeType};base64,${inlineImage.dataBase64}`;
    }

    await outbound.sendStarted();

    let deltaCount = 0;
    try {
      this.logger?.info("dispatch started", {
        request_id: request.request_id,
        session_id: request.session_id,
      });

      await this.rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx,
        cfg: this.cfg,
        dispatcherOptions: {
          deliver: async (payload: OutboundReplyPayload) => {
            // Rich media first: resolve each ref to a publicly fetchable URL
            // (remote URLs pass through; local files / data: are uploaded to
            // object storage) and forward it as a media.play event. Only the
            // URL crosses the wire — never the media bytes.
            const mediaUrls = resolveOutboundMediaUrls(payload);
            for (const ref of mediaUrls) {
              const resolved = await resolveMediaRefToUrl(ref, this.mediaDeps);
              if (!resolved) {
                this.logger?.warn("media skipped — non-remote ref but no uploader configured", {
                  request_id: request.request_id,
                });
                continue;
              }
              this.logger?.debug("deliver media", {
                request_id: request.request_id,
                kind: resolved.kind,
              });
              await outbound.sendMediaPlay(resolved.url, resolved.kind);
            }
            if (payload.text) {
              deltaCount += 1;
              this.logger?.debug("deliver called", {
                request_id: request.request_id,
                text_len: payload.text.length,
                delta_seq: deltaCount,
              });
              await outbound.sendDelta(payload.text);
            } else if (mediaUrls.length === 0) {
              this.logger?.warn("deliver_empty", { request_id: request.request_id });
            }
          },
        },
        signal: abortController.signal,
      });

      this.logger?.info("dispatch completed", {
        request_id: request.request_id,
        delta_count: deltaCount,
      });
      await outbound.sendCompleted();
    } catch (err) {
      if (
        abortController.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        this.logger?.info("dispatch interrupted", { request_id: request.request_id });
        await outbound.sendInterrupted();
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack ?? "") : "";
        this.logger?.error("dispatch failed", {
          request_id: request.request_id,
          error: message,
          stack: stack.split("\n")[1]?.trim() ?? "",
        });
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
    mime_type: stringValue(item["mime_type"]),
    data_base64: stringValue(item["data_base64"]),
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

function firstInlineImage(inputs: RequestInput[]): { mimeType: string; dataBase64: string } | undefined {
  for (const input of inputs) {
    if (input.type === "image" && input.data_base64 && input.mime_type) {
      return { mimeType: input.mime_type, dataBase64: input.data_base64 };
    }
  }
  return undefined;
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
