import { describe, it, expect, vi } from "vitest";
import { InboundHandler } from "../src/inbound-handler.js";
import type { AgentRequest, AgentInterrupt } from "../src/protocol.js";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

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

  it("emits media.play (url-only) for outbound media blocks, then the text delta", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: Record<string, unknown>) => Promise<void> } }) => {
              await dispatcherOptions.deliver({
                text: "看这张图",
                mediaUrl: "https://oss.example.com/cat.png",
              });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const payloads = sent.map(
      (m) => (m as Record<string, unknown>)["payload"] as Record<string, unknown>,
    );
    const types = payloads.map((p) => p["type"]);
    expect(types).toEqual(["response.started", "media.play", "output.delta", "response.completed"]);

    const media = payloads[1];
    expect(media["kind"]).toBe("image");
    expect(media["url"]).toBe("https://oss.example.com/cat.png");
    expect(media["data_base64"]).toBeUndefined(); // never any bytes

    expect(payloads[2]["text"]).toBe("看这张图");
  });

  it("emits one media.play per url in mediaUrls, with kind inferred per url", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: Record<string, unknown>) => Promise<void> } }) => {
              await dispatcherOptions.deliver({
                mediaUrls: ["https://a/song.mp3", "https://a/clip.mp4"],
              });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const payloads = sent.map(
      (m) => (m as Record<string, unknown>)["payload"] as Record<string, unknown>,
    );
    expect(payloads.map((p) => p["type"])).toEqual([
      "response.started",
      "media.play",
      "media.play",
      "response.completed",
    ]);
    expect(payloads[1]).toMatchObject({ kind: "audio", url: "https://a/song.mp3" });
    expect(payloads[2]).toMatchObject({ kind: "video", url: "https://a/clip.mp4" });
  });

  it("uploads local outbound media via the uploader, then emits media.play with the public url", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const uploaded: { body: Uint8Array; opts: unknown }[] = [];
    const uploader = {
      upload: async (body: Uint8Array, opts?: unknown) => {
        uploaded.push({ body, opts });
        return "http://obs-nmhhht6.cucloud.cn/ruanyanyuan-temp/abc.png";
      },
    };
    const readFile = async (_p: string) => new Uint8Array([7, 8, 9]);

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: Record<string, unknown>) => Promise<void> } }) => {
              await dispatcherOptions.deliver({ mediaUrl: "/tmp/cat.png" });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(
      transport, rt, "agent:main", undefined, undefined,
      { uploader, readFile },
    );
    await handler.handle(makeRequest());

    const payloads = sent.map(
      (m) => (m as Record<string, unknown>)["payload"] as Record<string, unknown>,
    );
    expect(payloads.map((p) => p["type"])).toEqual([
      "response.started",
      "media.play",
      "response.completed",
    ]);
    expect(payloads[1]).toMatchObject({
      type: "media.play",
      kind: "image",
      url: "http://obs-nmhhht6.cucloud.cn/ruanyanyuan-temp/abc.png",
    });
    expect(Array.from(uploaded[0].body)).toEqual([7, 8, 9]); // local bytes uploaded
  });

  it("skips local outbound media (no media.play) when no uploader is configured", async () => {
    const sent: object[] = [];
    const transport = { send: async (m: object) => { sent.push(m); } };

    const rt = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(
            async ({ dispatcherOptions }: { dispatcherOptions: { deliver: (p: Record<string, unknown>) => Promise<void> } }) => {
              await dispatcherOptions.deliver({ text: "看图", mediaUrl: "/tmp/cat.png" });
            }
          ),
        },
      },
    } as unknown as PluginRuntime;

    const handler = new InboundHandler(transport, rt, "agent:main");
    await handler.handle(makeRequest());

    const types = sent.map(
      (m) => ((m as Record<string, unknown>)["payload"] as Record<string, unknown>)["type"],
    );
    // local media dropped (no uploader), but the text still flows
    expect(types).toEqual(["response.started", "output.delta", "response.completed"]);
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
