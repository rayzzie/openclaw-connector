import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { AgentInterrupt, AgentRequest, ChannelSessionEnded, ChannelSessionStarted } from "./protocol.js";
import { buildSessionKey } from "./session-key.js";
import { OutboundHandler, type OutboundTransport } from "./outbound-handler.js";
import {
  resolveOutboundMediaUrls,
  type OutboundReplyPayload,
} from "./outbound-reply-payload.js";
import { resolveMediaRefToUrl, type ResolveMediaDeps } from "./outbound-media.js";
import { newMessageId } from "./message-id.js";
import type { Logger } from "./logger.js";
import {
  FakeDesktopFrameProvider,
  desktopFrameToVisualPayload,
  type DesktopFrameProvider,
} from "./desktop-frame-provider.js";

type RequestInput = {
  type?: string;
  text?: string;
  transcript?: string;
  mime_type?: string;
  data_base64?: string;
  image_url?: string;
  url?: string;
};

export type DesktopFrameStreamOptions = {
  fps?: number;
  intervalMs?: number;
};

export class InboundHandler {
  private readonly activeAborts = new Map<string, AbortController>();
  private readonly activeDesktopStreams = new Map<string, DesktopStreamController>();

  constructor(
    private readonly transport: OutboundTransport,
    private readonly rt: PluginRuntime,
    private readonly agentId: string,
    private readonly logger?: Logger,
    private readonly cfg?: unknown,
    private readonly desktopFrameProvider: DesktopFrameProvider = new FakeDesktopFrameProvider(),
    private readonly desktopFrameStreamOptions: DesktopFrameStreamOptions = {},
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

  async handleSessionStarted(message: ChannelSessionStarted): Promise<void> {
    if (message.channel?.type !== "sip_video") {
      return;
    }
    await this.activeDesktopStreams.get(message.session_id)?.stop(true);
    const visualStream = message.payload.visual_stream;
    const outbound = new OutboundHandler(
      this.transport,
      {
        agentId: message.agent_id,
        sessionId: message.session_id,
        turnId: visualStream.turn_id,
        requestId: visualStream.request_id,
        traceId: message.trace_id,
        responseId: visualStream.response_id,
      },
      this.logger,
    );
    const stream = this.startDefaultDesktopStream(message, outbound);
    this.activeDesktopStreams.set(message.session_id, stream);
  }

  async handleSessionEnded(message: ChannelSessionEnded): Promise<void> {
    const stream = this.activeDesktopStreams.get(message.session_id);
    if (!stream) {
      return;
    }
    this.activeDesktopStreams.delete(message.session_id);
    await stream.stop(true);
  }

  private startDefaultDesktopStream(
    message: ChannelSessionStarted,
    outbound: OutboundHandler,
  ): DesktopStreamController {
    const controller = new AbortController();
    const task = this.runDefaultDesktopStream(message, outbound, controller.signal);
    return {
      stop: async (sendCompleted = false) => {
        controller.abort();
        await task;
        if (sendCompleted && !outbound.hasLostTransport) {
          await outbound.sendCompleted();
        }
      },
    };
  }

  private async runDefaultDesktopStream(
    message: ChannelSessionStarted,
    outbound: OutboundHandler,
    signal: AbortSignal,
  ): Promise<void> {
    const intervalMs = streamIntervalMs(this.desktopFrameStreamOptions);
    let inFlight: Promise<void> | undefined;
    try {
      await outbound.sendVisualSurfaceSelect("desktop", "default_desktop_share");
      while (!signal.aborted && !outbound.hasLostTransport) {
        if (inFlight) {
          // Previous frame is still capturing/sending on a slow transport.
          // Skip this tick so frames never queue up behind a slow send and
          // delay control-plane messages (output.delta) on the shared WS.
          this.logger?.debug("desktop frame skipped — previous send in flight", {
            session_id: message.session_id,
          });
        } else {
          inFlight = this.captureAndSendFrame(message, outbound, signal).finally(() => {
            inFlight = undefined;
          });
        }
        await sleep(intervalMs, signal);
      }
      // Let the last in-flight frame finish so the caller's response.completed
      // stays the final event on the stream.
      await inFlight;
    } catch (err) {
      this.logger?.warn("desktop frame stream stopped", {
        session_id: message.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async captureAndSendFrame(
    message: ChannelSessionStarted,
    outbound: OutboundHandler,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const frame = await this.desktopFrameProvider.capture();
      if (signal.aborted || outbound.hasLostTransport) {
        return;
      }
      await outbound.sendVisualFrame(desktopFrameToVisualPayload(frame));
    } catch (err) {
      this.logger?.warn("desktop frame capture/send failed", {
        session_id: message.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

type DesktopStreamController = {
  stop(sendCompleted?: boolean): Promise<void>;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function streamIntervalMs(options: DesktopFrameStreamOptions): number {
  if (options.intervalMs !== undefined) {
    return Math.max(1, Math.floor(options.intervalMs));
  }
  const fps = Math.max(0.1, options.fps ?? 1);
  return Math.max(1, Math.floor(1000 / fps));
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
