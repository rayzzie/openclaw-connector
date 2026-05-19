import { describe, expect, it } from "vitest";

import { AckTracker } from "../src/ack-tracker.js";
import { MockAgent } from "../src/mock-agent.js";
import type { AgentEvent, AgentRequest } from "../src/protocol.js";

describe("MockAgent", () => {
  it("happy mode emits complete ordered stream", async () => {
    const sent = await runMode("happy");

    expect(sent.map((message) => message.payload.type)).toEqual([
      "response.started",
      "output.delta",
      "output.delta",
      "response.completed"
    ]);
    expect(sent.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("ack_drop mode emits nothing", async () => {
    const sent = await runMode("ack_drop");

    expect(sent).toEqual([]);
  });

  it("sequence_gap mode skips sequence 2", async () => {
    const sent = await runMode("sequence_gap");

    expect(sent.map((message) => message.sequence)).toEqual([1, 3, 4]);
  });

  it("slow mode emits full stream with delays", async () => {
    const sleeps: number[] = [];
    const sent = await runMode("slow", sleeps);

    expect(sent.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
    expect(sleeps).toContain(2000);
  });

  it("crash_after_started mode closes after started", async () => {
    const sent: AgentEvent[] = [];
    let closed: { code: number; reason: string } | undefined;
    const ackTracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 0 });
    const agent = new MockAgent({
      mode: "crash_after_started",
      ackTracker,
      send: async (message) => {
        sent.push(message);
        ackTracker.handleAck({ type: "ack", in_reply_to: message.message_id });
      },
      close: async (code, reason) => {
        closed = { code, reason };
      },
      sleep: async () => undefined
    });

    await agent.handleRequest(request());

    expect(sent.map((message) => message.payload.type)).toEqual(["response.started"]);
    expect(closed).toEqual({ code: 4000, reason: "mock_crash_after_started" });
  });
});

async function runMode(mode: "happy" | "ack_drop" | "sequence_gap" | "slow", sleeps: number[] = []): Promise<AgentEvent[]> {
  const sent: AgentEvent[] = [];
  const ackTracker = new AckTracker({ ackDeadlineMs: 50, ackMaxRetries: 0 });
  const agent = new MockAgent({
    mode,
    ackTracker,
    send: async (message) => {
      sent.push(message);
      ackTracker.handleAck({ type: "ack", in_reply_to: message.message_id });
    },
    close: async () => undefined,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });

  await agent.handleRequest(request());
  return sent;
}

function request(): AgentRequest {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.request",
    message_id: "msg_request_001",
    timestamp: "2026-05-19T10:00:00Z",
    agent_id: "agent_001",
    session_id: "sess_001",
    turn_id: "turn_001",
    request_id: "req_001",
    trace_id: "trace_001",
    payload: {}
  };
}
