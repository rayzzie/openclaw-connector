import { describe, expect, it } from "vitest";

import { AckTracker } from "../src/ack-tracker.js";
import { DedupeCache } from "../src/dedupe-cache.js";
import { EnvelopeRouter, type RouterTransport } from "../src/envelope-router.js";
import type { AgentRequest, AgentInterrupt, ChannelSessionEnded, ChannelSessionStarted, Envelope } from "../src/protocol.js";

function request(messageId = "msg_request_001"): AgentRequest {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.request",
    message_id: messageId,
    timestamp: "2026-05-19T10:00:00Z",
    agent_id: "agent_001",
    session_id: "sess_001",
    turn_id: "turn_001",
    request_id: "req_001",
    trace_id: "trace_001",
    ack: { mode: "required" },
    payload: {}
  };
}

describe("EnvelopeRouter", () => {
  it("acks and handles agent.request", async () => {
    const transport = new MemoryTransport();
    const handled: string[] = [];
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 }),
      onAgentRequest: async (message) => handled.push(message.message_id)
    });

    await router.route(request());

    expect(handled).toEqual(["msg_request_001"]);
    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_request_001" });
  });

  it("dedupes repeated agent.request and resends stored ack", async () => {
    const transport = new MemoryTransport();
    const handled: string[] = [];
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 }),
      onAgentRequest: async (message) => handled.push(message.message_id)
    });

    await router.route(request());
    await router.route(request());

    expect(handled).toEqual(["msg_request_001"]);
    expect(transport.sent.filter((message) => message.type === "ack")).toHaveLength(2);
  });

  it("routes ack to AckTracker", async () => {
    let acked = false;
    const ackTracker = new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 });
    const sendTask = ackTracker.send(outboundRequired(), async () => undefined).then((ok) => {
      acked = ok;
    });
    const router = new EnvelopeRouter({
      transport: new MemoryTransport(),
      ackTracker,
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await router.route({ type: "ack", in_reply_to: "msg_out_001" });
    await sendTask;

    expect(acked).toBe(true);
  });

  it("responds to ws.heartbeat", async () => {
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await router.route({ type: "ws.heartbeat", message_id: "hb_001" });

    expect(transport.sent[0]).toMatchObject({ type: "ws.heartbeat" });
  });

  it("acks agent.interrupt without closing the websocket", async () => {
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await router.route({
      protocol_version: "uag.agent.v1",
      type: "agent.interrupt",
      message_id: "msg_interrupt_001",
      timestamp: "2026-05-21T10:00:00Z",
      agent_id: "agent_001",
      session_id: "sess_001",
      turn_id: "turn_001",
      request_id: "req_001",
      trace_id: "trace_001",
      ack: { mode: "required" },
      payload: { reason: "user_barge_in" }
    });

    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_interrupt_001" });
    expect(transport.closed).toBeUndefined();
  });

  it("acks and handles channel.session.started", async () => {
    const transport = new MemoryTransport();
    const received: ChannelSessionStarted[] = [];
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 }),
      onChannelSessionStarted: async (message) => { received.push(message); },
    });

    await router.route(channelStarted());

    expect(received).toHaveLength(1);
    expect(received[0].session_id).toBe("sip.call_001");
    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_session_start_001" });
  });

  it("acks and handles channel.session.ended", async () => {
    const transport = new MemoryTransport();
    const received: ChannelSessionEnded[] = [];
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 }),
      onChannelSessionEnded: async (message) => { received.push(message); },
    });

    await router.route(channelEnded());

    expect(received).toHaveLength(1);
    expect(received[0].session_id).toBe("sip.call_001");
    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_session_end_001" });
  });

  it("sends agent.error and closes on unknown type", async () => {
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await router.route({ type: "surprise", message_id: "msg_bad" });

    expect(transport.sent[0]).toMatchObject({ type: "agent.error" });
    expect(transport.closed).toEqual({ code: 4002, reason: "protocol_error" });
  });

  it("closes without reconnect on connection.replaced", async () => {
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await router.route({ type: "connection.replaced", message_id: "msg_replaced" });

    expect(transport.closed).toEqual({ code: 4003, reason: "connection_replaced" });
  });
});

describe("onAgentInterrupt hook", () => {
  it("calls onAgentInterrupt when agent.interrupt arrives", async () => {
    const received: AgentInterrupt[] = [];
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 }),
      onAgentInterrupt: async (msg) => { received.push(msg); }
    });

    await router.route({
      protocol_version: "uag.agent.v1",
      type: "agent.interrupt",
      message_id: "msg_interrupt_001",
      timestamp: "2026-05-21T10:00:00Z",
      agent_id: "agent_001",
      session_id: "sess_001",
      turn_id: "turn_001",
      request_id: "req_001",
      trace_id: "trace_001",
      ack: { mode: "required" },
      payload: { reason: "user_barge_in" }
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("agent.interrupt");
    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_interrupt_001" });
  });

  it("does not call onAgentInterrupt when not provided", async () => {
    const transport = new MemoryTransport();
    const router = new EnvelopeRouter({
      transport,
      ackTracker: new AckTracker({ ackDeadlineMs: 10, ackMaxRetries: 1 }),
      dedupeCache: new DedupeCache({ ttlMs: 1000, maxEntries: 100 })
    });

    await expect(
      router.route({
        protocol_version: "uag.agent.v1",
        type: "agent.interrupt",
        message_id: "msg_interrupt_002",
        timestamp: "2026-05-21T10:00:00Z",
        agent_id: "agent_001",
        session_id: "sess_001",
        turn_id: "turn_001",
        request_id: "req_001",
        trace_id: "trace_001",
        ack: { mode: "required" },
        payload: { reason: "user_barge_in" }
      })
    ).resolves.not.toThrow();

    expect(transport.sent[0]).toMatchObject({ type: "ack", in_reply_to: "msg_interrupt_002" });
  });
});

class MemoryTransport implements RouterTransport {
  sent: object[] = [];
  closed: { code: number; reason: string } | undefined;

  async send(message: object): Promise<void> {
    this.sent.push(message);
  }

  async close(code: number, reason: string): Promise<void> {
    this.closed = { code, reason };
  }
}

function outboundRequired(): Envelope {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.event",
    message_id: "msg_out_001",
    timestamp: "2026-05-19T10:00:00Z",
    ack: { mode: "required" },
    payload: {}
  };
}

function channelStarted(): ChannelSessionStarted {
  return {
    protocol_version: "uag.agent.v1",
    type: "channel.session.started",
    message_id: "msg_session_start_001",
    timestamp: "2026-05-27T10:00:00Z",
    agent_id: "agent_001",
    session_id: "sip.call_001",
    trace_id: "trace_call_001",
    ack: { mode: "required" },
    channel: { type: "sip_video", phone_number: "+8618501206838" },
    payload: {
      call_id: "call_001",
      visual_stream: {
        turn_id: "turn_session_visual",
        request_id: "req_session_visual",
        response_id: "resp_session_visual",
      },
    },
  };
}

function channelEnded(): ChannelSessionEnded {
  return {
    protocol_version: "uag.agent.v1",
    type: "channel.session.ended",
    message_id: "msg_session_end_001",
    timestamp: "2026-05-27T10:01:00Z",
    agent_id: "agent_001",
    session_id: "sip.call_001",
    trace_id: "trace_call_001",
    ack: { mode: "required" },
    payload: { reason: "bye" },
  };
}
