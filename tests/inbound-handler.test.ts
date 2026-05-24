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
