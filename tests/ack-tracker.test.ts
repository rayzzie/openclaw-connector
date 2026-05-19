import { describe, expect, it } from "vitest";

import { AckTracker } from "../src/ack-tracker.js";
import type { Envelope } from "../src/protocol.js";

function requiredEnvelope(messageId = "msg_001"): Envelope {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.event",
    message_id: messageId,
    timestamp: "2026-05-19T10:00:00Z",
    agent_id: "agent_001",
    session_id: "sess_001",
    turn_id: "turn_001",
    request_id: "req_001",
    response_id: "resp_001",
    trace_id: "trace_001",
    sequence: 1,
    ack: { mode: "required", deadline_ms: 10 },
    payload: {}
  };
}

describe("AckTracker", () => {
  it("sends once when ack arrives", async () => {
    const sent: Envelope[] = [];
    const tracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 2 });

    const ok = await tracker.send(requiredEnvelope(), async (message) => {
      sent.push(message);
      tracker.handleAck({ type: "ack", in_reply_to: message.message_id });
    });

    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("accepts ack from another task", async () => {
    const sent: Envelope[] = [];
    const tracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 2 });

    const sendTask = tracker.send(requiredEnvelope(), async (message) => {
      sent.push(message);
      setTimeout(() => tracker.handleAck({ type: "ack", in_reply_to: message.message_id }), 1);
    });

    await expect(sendTask).resolves.toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("accepts ack after second retry", async () => {
    const sent: Envelope[] = [];
    const tracker = new AckTracker({ ackDeadlineMs: 1, ackMaxRetries: 2 });

    const ok = await tracker.send(requiredEnvelope(), async (message) => {
      sent.push(message);
      if (sent.length === 3) {
        tracker.handleAck({ type: "ack", in_reply_to: message.message_id });
      }
    });

    expect(ok).toBe(true);
    expect(sent.map((message) => message.message_id)).toEqual(["msg_001", "msg_001", "msg_001"]);
  });

  it("ignores late ack after failure", async () => {
    const failures: string[] = [];
    const tracker = new AckTracker({
      ackDeadlineMs: 1,
      ackMaxRetries: 1,
      onFailure: (message) => failures.push(message.message_id)
    });

    const ok = await tracker.send(requiredEnvelope(), async () => undefined);
    const late = tracker.handleAck({ type: "ack", in_reply_to: "msg_001" });

    expect(ok).toBe(false);
    expect(late).toBe(false);
    expect(failures).toEqual(["msg_001"]);
  });

  it("returns false when closed while send pending", async () => {
    const tracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 1 });

    const task = tracker.send(requiredEnvelope(), async () => {
      tracker.close("test");
    });

    await expect(task).resolves.toBe(false);
  });

  it("rejects concurrent sends with same message_id", async () => {
    const tracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 1 });
    const first = tracker.send(requiredEnvelope(), async () => undefined);

    await expect(tracker.send(requiredEnvelope(), async () => undefined)).rejects.toThrow("already pending");
    tracker.close("cleanup");
    await first;
  });
});
