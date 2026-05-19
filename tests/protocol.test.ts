import { describe, expect, it } from "vitest";

import {
  validateAgentRequest,
  validateConnectionAccepted,
  validateEnvelope,
  validateHeartbeatMessage
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
});
