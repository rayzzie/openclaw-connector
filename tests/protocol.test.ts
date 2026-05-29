import { describe, expect, it } from "vitest";

import {
  validateAgentRequest,
  validateChannelSessionEnded,
  validateChannelSessionStarted,
  validateConnectionAccepted,
  validateEnvelope,
  validateHeartbeatMessage,
  validateVisualEventPayload
} from "../src/protocol.js";

describe("protocol validation", () => {
  it("validates connection.accepted", () => {
    const result = validateConnectionAccepted({
      protocol_version: "uag.agent.v1",
      type: "connection.accepted",
      message_id: "msg_1",
      timestamp: "2026-05-19T10:00:00Z",
      connection_id: "conn_1",
      agent_id: "agent_001",
      payload: { heartbeat_interval_sec: 20 }
    });

    expect(result.ok).toBe(true);
  });

  it("rejects envelopes missing type", () => {
    const result = validateEnvelope({
      protocol_version: "uag.agent.v1",
      message_id: "msg_1",
      timestamp: "2026-05-19T10:00:00Z"
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("type");
  });

  it("validates agent.request required fields", () => {
    const result = validateAgentRequest({
      protocol_version: "uag.agent.v1",
      type: "agent.request",
      message_id: "msg_1",
      timestamp: "2026-05-19T10:00:00Z",
      agent_id: "agent_001",
      session_id: "sess_001",
      turn_id: "turn_001",
      request_id: "req_001",
      trace_id: "trace_001",
      payload: {}
    });

    expect(result.ok).toBe(true);
  });

  it("validates channel.session.started required fields and visual stream context", () => {
    const result = validateChannelSessionStarted({
      protocol_version: "uag.agent.v1",
      type: "channel.session.started",
      message_id: "msg_session_start_001",
      timestamp: "2026-05-27T10:00:00Z",
      agent_id: "agent_001",
      session_id: "sip.call_001",
      trace_id: "trace_call_001",
      channel: { type: "sip_video", phone_number: "+8618501206838" },
      payload: {
        call_id: "call_001",
        visual_stream: {
          turn_id: "turn_session_visual",
          request_id: "req_session_visual",
          response_id: "resp_session_visual",
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("validates channel.session.ended required fields", () => {
    const result = validateChannelSessionEnded({
      protocol_version: "uag.agent.v1",
      type: "channel.session.ended",
      message_id: "msg_session_end_001",
      timestamp: "2026-05-27T10:01:00Z",
      agent_id: "agent_001",
      session_id: "sip.call_001",
      trace_id: "trace_call_001",
      payload: { reason: "bye" },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects heartbeat without connection_id", () => {
    const result = validateHeartbeatMessage({
      protocol_version: "uag.agent.v1",
      type: "ws.heartbeat",
      message_id: "msg_1",
      timestamp: "2026-05-19T10:00:00Z",
      agent_id: "agent_001",
      payload: {}
    });

    expect(result.ok).toBe(false);
  });

  it("validates visual.frame payload", () => {
    const result = validateVisualEventPayload({
      type: "visual.frame",
      surface: "webchat",
      mime_type: "image/jpeg",
      data_base64: "ZnJhbWU=",
      ttl_ms: 1000
    });

    expect(result.ok).toBe(true);
  });

  it("rejects visual.asset without url or data_base64", () => {
    const result = validateVisualEventPayload({
      type: "visual.asset",
      asset_type: "image",
      mime_type: "image/png",
      display: "replace_surface"
    });

    expect(result.ok).toBe(false);
  });
});
