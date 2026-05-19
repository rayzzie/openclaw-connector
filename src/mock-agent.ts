import type { AckTracker } from "./ack-tracker.js";
import { newMessageId } from "./message-id.js";
import type { AgentEvent, AgentRequest } from "./protocol.js";
import { SequenceGenerator } from "./sequence-generator.js";
import { StreamEmitter } from "./stream-emitter.js";

export type MockMode = "happy" | "ack_drop" | "sequence_gap" | "slow" | "crash_after_started";

export type MockAgentOptions = {
  mode: MockMode | string;
  ackTracker: AckTracker;
  send: (message: AgentEvent) => Promise<void>;
  close: (code: number, reason: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
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
    if (this.options.mode === "slow") {
      await new StreamEmitter(this.emitterOptions()).emit(this.happyEvents(request), [0, 2000, 2000, 0]);
      return;
    }
    await new StreamEmitter(this.emitterOptions()).emit(this.happyEvents(request), [100, 0, 0, 0]);
  }

  private happyEvents(request: AgentRequest): AgentEvent[] {
    return [
      this.event(request, "response.started"),
      this.event(request, "output.delta", { speech_delta: "我看到了，" }),
      this.event(request, "output.delta", { speech_delta: "请先检查电源线。" }),
      this.event(request, "response.completed")
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

  private emitterOptions(): { ackTracker: AckTracker; send: (message: AgentEvent) => Promise<void>; sleep: (ms: number) => Promise<void> } {
    return {
      ackTracker: this.options.ackTracker,
      send: this.options.send,
      sleep: this.options.sleep
    };
  }
}
