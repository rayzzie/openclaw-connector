import { describe, expect, it } from "vitest";

import { AckTracker } from "../src/ack-tracker.js";
import { StreamEmitter } from "../src/stream-emitter.js";
import type { AgentEvent } from "../src/protocol.js";

describe("StreamEmitter", () => {
  it("waits for ack before sending the next required event", async () => {
    const sent: AgentEvent[] = [];
    const ackTracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 0 });
    const emitter = new StreamEmitter({
      ackTracker,
      send: async (message) => {
        sent.push(message);
        if (sent.length === 1) {
          setTimeout(() => ackTracker.handleAck({ type: "ack", in_reply_to: message.message_id }), 1);
        }
        if (sent.length === 2) {
          ackTracker.handleAck({ type: "ack", in_reply_to: message.message_id });
        }
      },
      sleep: async () => undefined
    });

    await emitter.emit([
      event(1, "response.started"),
      event(2, "response.completed")
    ]);

    expect(sent.map((message) => message.sequence)).toEqual([1, 2]);
  });
});

function event(sequence: number, type: string): AgentEvent {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.event",
    message_id: `msg_${sequence}`,
    timestamp: "2026-05-19T10:00:00Z",
    agent_id: "agent_001",
    session_id: "sess_001",
    turn_id: "turn_001",
    request_id: "req_001",
    response_id: "resp_001",
    trace_id: "trace_001",
    sequence,
    ack: { mode: "required" },
    payload: { type }
  };
}
