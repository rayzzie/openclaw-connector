import type { AckTracker } from "./ack-tracker.js";
import { newMessageId } from "./message-id.js";
import type { AgentEvent, AgentRequest } from "./protocol.js";
import { SequenceGenerator } from "./sequence-generator.js";
import { StreamEmitter } from "./stream-emitter.js";

export type MockMode =
  | "happy"
  | "ack_drop"
  | "sequence_gap"
  | "slow"
  | "crash_after_started"
  | "visual_desktop"
  | "visual_generated_image"
  | "no_visual"
  | "screenshot";

export type MockAgentOptions = {
  mode: MockMode | string;
  ackTracker: AckTracker;
  send: (message: AgentEvent) => Promise<void>;
  close: (code: number, reason: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  // screenshot mode options
  screenshotUrl?: string;
  screenshotChromePath?: string;
  screenshotWaitMs?: number;
  screenshotQuality?: number;
  screenshotRefreshMs?: number;  // 0 = single shot per request, >0 = keep refreshing during call
};

export class MockAgent {
  private readonly sequences = new SequenceGenerator();

  constructor(private readonly options: MockAgentOptions) {}

  async handleRequest(request: AgentRequest): Promise<void> {
    if (this.options.mode === "ack_drop") {
      return;
    }
    if (this.options.mode === "crash_after_started") {
      await new StreamEmitter(this.emitterOptions()).emit([this.event(request, "response.started")]);
      await this.options.sleep(500);
      await this.options.close(4000, "mock_crash_after_started");
      return;
    }
    if (this.options.mode === "sequence_gap") {
      await new StreamEmitter(this.emitterOptions()).emit([
        this.event(request, "response.started"),
        this.event(request, "output.delta", { speech_delta: "跳了一个" }, 3),
        this.event(request, "response.completed", {}, 4)
      ]);
      return;
    }
    if (this.options.mode === "visual_desktop") {
      await new StreamEmitter(this.emitterOptions()).emit([...this.desktopVisualEvents(request), ...this.speechEvents(request)]);
      return;
    }
    if (this.options.mode === "visual_generated_image") {
      await new StreamEmitter(this.emitterOptions()).emit([...this.generatedImageEvents(request), ...this.speechEvents(request, "图片已生成。", "请看屏幕。")]);
      return;
    }
    if (this.options.mode === "no_visual") {
      await new StreamEmitter(this.emitterOptions()).emit(this.speechEvents(request));
      return;
    }
    if (this.options.mode === "screenshot") {
      await this.handleScreenshot(request);
      return;
    }
    if (this.options.mode === "slow") {
      await new StreamEmitter(this.emitterOptions()).emit(this.happyEvents(request), [0, 0, 0, 2000, 2000, 0]);
      return;
    }
    await new StreamEmitter(this.emitterOptions()).emit(this.happyEvents(request), [0, 100, 0, 0, 0, 0]);
  }

  private happyEvents(request: AgentRequest): AgentEvent[] {
    return [...this.webchatVisualEvents(request), ...this.speechEvents(request)];
  }

  private speechEvents(request: AgentRequest, firstDelta = "我看到了，", secondDelta = "请先检查电源线。"): AgentEvent[] {
    return [
      this.event(request, "response.started"),
      this.event(request, "output.delta", { speech_delta: firstDelta }),
      this.event(request, "output.delta", { speech_delta: secondDelta }),
      this.event(request, "response.completed")
    ];
  }

  private webchatVisualEvents(request: AgentRequest): AgentEvent[] {
    return [
      this.event(request, "visual.surface.select", { surface: "webchat", reason: "default" }),
      this.event(request, "visual.frame", {
        surface: "webchat",
        mime_type: "image/jpeg",
        data_base64: WEBCHAT_FRAME_JPEG_BASE64,
        ttl_ms: 1000
      })
    ];
  }

  private desktopVisualEvents(request: AgentRequest): AgentEvent[] {
    return [
      this.event(request, "visual.surface.select", { surface: "desktop", reason: "user_requested" }),
      this.event(request, "visual.frame", {
        surface: "desktop",
        mime_type: "image/jpeg",
        data_base64: DESKTOP_FRAME_JPEG_BASE64,
        ttl_ms: 1000
      })
    ];
  }

  private generatedImageEvents(request: AgentRequest): AgentEvent[] {
    return [
      this.event(request, "visual.asset", {
        asset_type: "image",
        mime_type: "image/png",
        url: `https://example.com/generated/${request.request_id}.png`,
        display: "replace_surface",
        ttl_ms: 8000
      })
    ];
  }

  private event(request: AgentRequest, payloadType: string, extraPayload: Record<string, unknown> = {}, forcedSequence?: number): AgentEvent {
    const responseId = `resp_${request.request_id}`;
    return {
      protocol_version: request.protocol_version,
      type: "agent.event",
      message_id: newMessageId("msg_event"),
      timestamp: new Date().toISOString(),
      agent_id: request.agent_id,
      session_id: request.session_id,
      turn_id: request.turn_id,
      request_id: request.request_id,
      response_id: responseId,
      trace_id: request.trace_id,
      sequence: forcedSequence ?? this.sequences.next(request.request_id, responseId),
      ack: { mode: "required" },
      payload: { type: payloadType, ...extraPayload }
    };
  }

  private async handleScreenshot(request: AgentRequest): Promise<void> {
    const url = this.options.screenshotUrl;
    if (!url) {
      // No URL configured — fall back to speech only
      await new StreamEmitter(this.emitterOptions()).emit(this.speechEvents(request, "未配置截图地址。", ""));
      return;
    }

    const { takeScreenshot } = await import("./screenshotter.js");
    const refreshMs = this.options.screenshotRefreshMs ?? 0;
    const emitter = new StreamEmitter(this.emitterOptions());

    // Initial frame + speech
    let jpegBuf: Buffer;
    try {
      jpegBuf = await takeScreenshot({
        url,
        executablePath: this.options.screenshotChromePath,
        waitMs: this.options.screenshotWaitMs ?? 500,
        quality: this.options.screenshotQuality ?? 75,
      });
    } catch (err) {
      await emitter.emit(this.speechEvents(request, "截图失败，", String(err).slice(0, 60)));
      return;
    }

    const b64 = jpegBuf.toString("base64");
    const ttlMs = refreshMs > 0 ? refreshMs + 500 : 5000;

    // Send initial frame then speech
    await emitter.emit([
      this.event(request, "visual.surface.select", { surface: "desktop", reason: "screenshot" }),
      this.event(request, "visual.frame", { surface: "desktop", mime_type: "image/jpeg", data_base64: b64, ttl_ms: ttlMs }),
      ...this.speechEvents(request, "已为您打开页面，", "请查看屏幕。"),
    ]);

    // If refresh enabled, keep pushing updated frames until response.completed is sent
    if (refreshMs > 0) {
      const deadline = Date.now() + 30_000; // max 30s
      while (Date.now() < deadline) {
        await this.options.sleep(refreshMs);
        try {
          const fresh = await takeScreenshot({
            url,
            executablePath: this.options.screenshotChromePath,
            waitMs: 0,
            quality: this.options.screenshotQuality ?? 75,
          });
          const freshB64 = fresh.toString("base64");
          await this.options.send(
            this.event(request, "visual.frame", { surface: "desktop", mime_type: "image/jpeg", data_base64: freshB64, ttl_ms: ttlMs })
          );
        } catch {
          break;
        }
      }
    }
  }

  private emitterOptions(): { ackTracker: AckTracker; send: (message: AgentEvent) => Promise<void>; sleep: (ms: number) => Promise<void> } {
    return {
      ackTracker: this.options.ackTracker,
      send: this.options.send,
      sleep: this.options.sleep
    };
  }
}

const WEBCHAT_FRAME_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnaKKK+qPFP//Z";

const DESKTOP_FRAME_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCrRRRXGfKH/9k=";
