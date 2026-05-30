import { describe, it, expect } from "vitest";
import { OutboundHandler } from "../src/outbound-handler.js";

function makeHandler() {
  const sent: object[] = [];
  const transport = { send: async (m: object) => { sent.push(m); } };
  const handler = new OutboundHandler(transport, {
    agentId: "agent:main",
    sessionId: "sess_1",
    turnId: "turn_1",
    requestId: "req_1",
    traceId: "trace_1",
    responseId: "resp_1",
  });
  return { handler, sent };
}

type Msg = Record<string, unknown>;
type Payload = Record<string, unknown>;

describe("OutboundHandler", () => {
  it("sendStarted sends response.started with sequence 1", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendStarted();
    expect(sent).toHaveLength(1);
    const msg = sent[0] as Msg;
    expect(msg["type"]).toBe("agent.event");
    expect((msg["payload"] as Payload)["type"]).toBe("response.started");
    expect(msg["sequence"]).toBe(1);
    expect(msg["agent_id"]).toBe("agent:main");
    expect(msg["session_id"]).toBe("sess_1");
    expect(msg["turn_id"]).toBe("turn_1");
    expect(msg["request_id"]).toBe("req_1");
    expect(msg["response_id"]).toBe("resp_1");
    expect(msg["trace_id"]).toBe("trace_1");
  });

  it("sendDelta increments sequence each call", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendStarted();
    await handler.sendDelta("hello ");
    await handler.sendDelta("world");
    expect(sent).toHaveLength(3);
    expect((sent[1] as Msg)["sequence"]).toBe(2);
    expect((sent[2] as Msg)["sequence"]).toBe(3);
    const deltaPayload = (sent[1] as Msg)["payload"] as Payload;
    expect(deltaPayload["type"]).toBe("output.delta");
    expect(deltaPayload["kind"]).toBe("text");
    expect(deltaPayload["text"]).toBe("hello ");
    expect(deltaPayload["text_delta"]).toBe("hello ");
  });

  it("sendCompleted sends response.completed", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendCompleted();
    const msg = sent[0] as Msg;
    expect(msg["type"]).toBe("agent.event");
    expect((msg["payload"] as Payload)["type"]).toBe("response.completed");
  });

  it("sendInterrupted sends response.interrupted", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendInterrupted();
    expect(((sent[0] as Msg)["payload"] as Payload)["type"]).toBe("response.interrupted");
  });

  it("sendFailed sends response.failed with error detail", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendFailed(new Error("boom"));
    const payload = ((sent[0] as Msg)["payload"] as Payload);
    expect(payload["type"]).toBe("response.failed");
    expect(((payload["error"] as Payload)["message"])).toBe("boom");
  });

  it("sendFailed handles non-Error values", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendFailed("plain string error");
    const payload = ((sent[0] as Msg)["payload"] as Payload);
    expect(payload["type"]).toBe("response.failed");
    expect(typeof (payload["error"] as Payload)["message"]).toBe("string");
  });

  it("sends visual surface selection and visual frame events", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendStarted();
    await handler.sendVisualSurfaceSelect("desktop", "default_desktop_share");
    await handler.sendVisualFrame({
      type: "visual.frame",
      surface: "desktop",
      mime_type: "image/png",
      data_base64: "ZmFrZQ==",
      ttl_ms: 2000,
    });

    expect(sent).toHaveLength(3);
    expect((sent[1] as Msg)["sequence"]).toBe(2);
    expect((sent[2] as Msg)["sequence"]).toBe(3);
    expect((sent[1] as Msg)["payload"]).toMatchObject({
      type: "visual.surface.select",
      surface: "desktop",
      reason: "default_desktop_share",
    });
    expect((sent[2] as Msg)["payload"]).toMatchObject({
      type: "visual.frame",
      surface: "desktop",
      mime_type: "image/png",
      data_base64: "ZmFrZQ==",
      ttl_ms: 2000,
    });
  });

  it("sendMediaPlay sends a media.play event carrying only the url (no bytes)", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendStarted();
    await handler.sendMediaPlay("https://oss.example.com/clip.mp4", "video");

    expect(sent).toHaveLength(2);
    const msg = sent[1] as Msg;
    expect(msg["type"]).toBe("agent.event");
    expect(msg["sequence"]).toBe(2);
    const payload = msg["payload"] as Payload;
    expect(payload["type"]).toBe("media.play");
    expect(payload["kind"]).toBe("video");
    expect(payload["url"]).toBe("https://oss.example.com/clip.mp4");
    // never carry raw bytes over the wire
    expect(payload["data_base64"]).toBeUndefined();
    expect(payload["bytes"]).toBeUndefined();
  });

  it("sequence is monotonically increasing across all send* calls", async () => {
    const { handler, sent } = makeHandler();
    await handler.sendStarted();
    await handler.sendDelta("a");
    await handler.sendCompleted();
    const seqs = sent.map((m) => (m as Msg)["sequence"] as number);
    expect(seqs).toEqual([1, 2, 3]);
  });
});
