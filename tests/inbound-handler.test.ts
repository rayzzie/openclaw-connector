import { describe, it, expect, vi } from "vitest";
import { InboundHandler } from "../src/inbound-handler.js";
import type { AgentRequest, AgentInterrupt, ChannelSessionEnded, ChannelSessionStarted } from "../src/protocol.js";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { FakeDesktopFrameProvider } from "../src/desktop-frame-provider.js";

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.request",
    message_id: "msg_1",
    timestamp: new Date().toISOString(),
    agent_id: "agent:main",
    session_id: "sess_1",
    turn_id: "turn_1",
    request_id: "req_1",
    trace_id: "trace_1",
    payload: {
      inputs: [{ type: "text", text: "hello" }],
      context: { caller_phone: "+8613800138000" },
      channel: "rcs",
    },
    ...overrides,
  };
}

function makeInterrupt(turnId: string): AgentInterrupt {
  return {
    protocol_version: "uag.agent.v1",
    type: "agent.interrupt",
    message_id: "msg_int",
    timestamp: new Date().toISOString(),
    agent_id: "agent:main",
    session_id: "sess_1",
    turn_id: turnId,
    request_id: "req_1",
    trace_id: "trace_1",
    payload: {},
  };
}

describe("InboundHandler", () => {
  it("sends started, delta chunks, completed when dispatch succeeds", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: { text: string }) => Promise<void> } }) => {
              await dispatcherOptions.deliver({ text: "hi " });
              await dispatcherOptions.deliver({ text: "there" });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"]
    );
    expect(types).toEqual(["response.started", "output.delta", "output.delta", "response.completed"]);
    expect(sent).toHaveLength(4);
  });

  it("sends response.failed when dispatch throws a non-abort error", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async () => {
            throw new Error("agent down");
          }),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"]
    );
    expect(types).toContain("response.failed");
    expect(types).not.toContain("response.completed");
  });

  it("sends response.interrupted when interrupt() is called for the turn", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    let abortFn: (() => void) | undefined;
    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ signal }: { signal?: AbortSignal }) => {
              await new Promise<void>((_, reject) => {
                if (signal) {
                  signal.addEventListener("abort", () => {
                    reject(new DOMException("aborted", "AbortError"));
                  });
                }
                abortFn = () => reject(new DOMException("aborted", "AbortError"));
              });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    const request = makeRequest({ turn_id: "turn_interrupt" });
    const handlePromise = handler.handle(request);

    // Give the async dispatch a tick to start
    await new Promise((r) => setTimeout(r, 0));

    handler.interrupt(makeInterrupt("turn_interrupt"));
    abortFn?.();

    await handlePromise;

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"]
    );
    expect(types).toContain("response.interrupted");
    expect(types).not.toContain("response.completed");
  });

  it("interrupt for unknown turn_id does nothing", async () => {
    const handler = new InboundHandler(
      { send: async () => {} },
      { channel: { reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() } } } as unknown as PluginRuntime,
      "agent:main"
    );
    // Should not throw
    handler.interrupt(makeInterrupt("unknown_turn"));
  });

  it("passes correct ctx fields to dispatchReplyWithBufferedBlockDispatcher", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    let capturedCtx: unknown;
    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async ({ ctx }: { ctx: unknown }) => {
            capturedCtx = ctx;
          }),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const ctx = capturedCtx as Record<string, unknown>;
    expect(ctx["SessionKey"]).toBe("uniagentgate:phone:+8613800138000");
    expect(ctx["From"]).toBe("+8613800138000");
    expect(ctx["To"]).toBe("agent:main");
    expect(ctx["ChatType"]).toBe("direct");
    expect(ctx["Provider"]).toBe("uniagentgate");
    expect(ctx["Surface"]).toBe("rcs");
    expect(ctx["MessageSid"]).toBe("req_1");
    expect(ctx["text"]).toBe("hello");
    expect(ctx["Body"]).toBe("hello");
    expect(ctx["BodyForAgent"]).toBe("hello");
    expect(ctx["CommandBody"]).toBe("hello");
    expect(ctx["RawBody"]).toBe("hello");
  });

  it("passes inline image input from Gateway to OpenClaw context", async () => {
    const transport = { send: async () => {} };

    let capturedCtx: unknown;
    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async ({ ctx }: { ctx: unknown }) => {
            capturedCtx = ctx;
          }),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(
      makeRequest({
        payload: {
          inputs: [
            { type: "speech_transcript", text: "看一下屏幕" },
            { type: "image", mime_type: "image/jpeg", data_base64: "ZnJhbWU=" },
          ],
          context: { caller_phone: "+8613800138000" },
          channel: "sip_video",
        },
      }),
    );

    const ctx = capturedCtx as Record<string, unknown>;
    expect(ctx["MediaMimeType"]).toBe("image/jpeg");
    expect(ctx["MediaBase64"]).toBe("ZnJhbWU=");
    expect(ctx["MediaDataUrl"]).toBe("data:image/jpeg;base64,ZnJhbWU=");
  });

  it("sends response.completed even when all deliver calls have empty text (empty_agent_response path)", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: { text?: string }) => Promise<void> } }) => {
              await dispatcherOptions.deliver({});
              await dispatcherOptions.deliver({ text: "" });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"]
    );
    expect(types).toEqual(["response.started", "response.completed"]);
  });

  it("does not send output.delta when deliver is called with empty or missing text", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: { text?: string }) => Promise<void> } }) => {
              await dispatcherOptions.deliver({});
              await dispatcherOptions.deliver({ text: "" });
              await dispatcherOptions.deliver({ text: "real" });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"]
    );
    expect(types).toEqual(["response.started", "output.delta", "response.completed"]);
    const deltaPayload = (sent[1] as Record<string, unknown>)["payload"] as Record<string, unknown>;
    expect(deltaPayload["text"]).toBe("real");
  });

  it("streams default fake desktop frames between session started and ended", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };
    let tick = 0;

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 35));
          }),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(
      transport,
      rt,
      "agent:main",
      undefined,
      undefined,
      new FakeDesktopFrameProvider({
        width: 320,
        height: 180,
        now: () => new Date(`2026-05-27T10:00:0${tick++}.000Z`),
      }),
      { intervalMs: 10 },
    );

    await handler.handleSessionStarted(sessionStarted());
    await new Promise((resolve) => setTimeout(resolve, 35));
    await handler.handleSessionEnded(sessionEnded());

    const payloads = sent.map((m) => (m as Record<string, unknown>)["payload"] as Record<string, unknown>);
    const types = payloads.map((p) => p["type"]);
    expect(types[0]).toBe("visual.surface.select");
    expect(types.at(-1)).toBe("response.completed");
    expect(types.filter((type) => type === "visual.frame").length).toBeGreaterThanOrEqual(2);
    expect(payloads[0]).toMatchObject({
      surface: "desktop",
      reason: "default_desktop_share",
    });
    const frames = payloads.filter((p) => p["type"] === "visual.frame");
    expect(frames[0]).toMatchObject({ surface: "desktop", mime_type: "image/png", ttl_ms: 2000 });
    expect(Buffer.from(String(frames[0]["data_base64"]), "base64").readUInt32BE(16)).toBe(320);
    expect(frames[0]["data_base64"]).not.toBe(frames[1]["data_base64"]);
  });

  it("skips desktop frames while a previous send is in flight (slow transport)", async () => {
    const sent: object[] = [];
    let releaseFrame: () => void = () => {};
    const frameGate = new Promise<void>((resolve) => {
      releaseFrame = resolve;
    });
    const transport = {
      send: async (m: object) => {
        sent.push(m);
        const type = ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"];
        if (type === "visual.frame") {
          await frameGate; // hold the first frame's send open
        }
      },
    };
    let tick = 0;

    const rt = {
      channel: { reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() } },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(
      transport,
      rt,
      "agent:main",
      undefined,
      undefined,
      new FakeDesktopFrameProvider({
        width: 320,
        height: 180,
        now: () => new Date(`2026-05-27T10:00:${String(tick++).padStart(2, "0")}.000Z`),
      }),
      { intervalMs: 5 },
    );

    await handler.handleSessionStarted(sessionStarted());
    // Many ticks (~8) elapse while the first frame's send is gated open.
    await new Promise((resolve) => setTimeout(resolve, 40));

    const framesWhileGated = sent.filter(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"] === "visual.frame",
    ).length;
    // Without skip protection this would be ~8; with it, only one frame is in flight.
    expect(framesWhileGated).toBe(1);

    releaseFrame();
    await handler.handleSessionEnded(sessionEnded());
  });

  it("uses top-level Gateway channel fields for RCS phone and surface", async () => {
    const transport = { send: async () => {} };

    let capturedCtx: unknown;
    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async ({ ctx }: { ctx: unknown }) => {
            capturedCtx = ctx;
          }),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle({
      ...makeRequest({
        payload: {
          inputs: [{ type: "text", text: "你好" }],
          metadata: { file_url: "https://example.com/image.jpg" },
        },
      }),
      channel: {
        type: "rcs",
        phone_number: "+8618501206838",
        external_session_id: "+8618501206838",
      },
    } as AgentRequest);

    const ctx = capturedCtx as Record<string, unknown>;
    expect(ctx["SessionKey"]).toBe("uniagentgate:phone:+8618501206838");
    expect(ctx["From"]).toBe("+8618501206838");
    expect(ctx["Surface"]).toBe("rcs");
    expect(ctx["MediaPath"]).toBe("https://example.com/image.jpg");
    expect(ctx["text"]).toBe("你好");
  });
});

function sessionStarted(): ChannelSessionStarted {
  return {
    protocol_version: "uag.agent.v1",
    type: "channel.session.started",
    message_id: "msg_session_start_001",
    timestamp: "2026-05-27T10:00:00Z",
    agent_id: "agent:main",
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
  };
}

function sessionEnded(): ChannelSessionEnded {
  return {
    protocol_version: "uag.agent.v1",
    type: "channel.session.ended",
    message_id: "msg_session_end_001",
    timestamp: "2026-05-27T10:01:00Z",
    agent_id: "agent:main",
    session_id: "sip.call_001",
    trace_id: "trace_call_001",
    payload: { reason: "bye" },
  };
}
