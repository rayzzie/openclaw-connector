import { describe, it, expect, vi } from "vitest";
import { EnvelopeRouter } from "./envelope-router.js";
import { AckTracker } from "./ack-tracker.js";
import { DedupeCache } from "./dedupe-cache.js";

function makeRouter(opts: {
  onAgentRequest?: Parameters<typeof EnvelopeRouter.prototype.constructor>[0]["onAgentRequest"];
  onAgentInterrupt?: Parameters<typeof EnvelopeRouter.prototype.constructor>[0]["onAgentInterrupt"];
}) {
  const sends: object[] = [];
  const transport = { send: async (m: object) => { sends.push(m); }, close: vi.fn() };
  const router = new EnvelopeRouter({
    transport,
    ackTracker: new AckTracker({ ackDeadlineMs: 3000, ackMaxRetries: 2 }),
    dedupeCache: new DedupeCache(),
    ...opts,
  });
  return { router, sends };
}

const BASE = {
  protocol_version: "uag.agent.v1",
  message_id: "msg_1",
  timestamp: new Date().toISOString(),
  agent_id: "agent:main",
  session_id: "sess_1",
  turn_id: "turn_1",
  request_id: "req_1",
  trace_id: "trace_1",
  payload: {},
};

describe("EnvelopeRouter interrupt hook", () => {
  it("calls onAgentInterrupt when agent.interrupt arrives", async () => {
    const received: unknown[] = [];
    const { router } = makeRouter({
      onAgentInterrupt: async (msg) => { received.push(msg); },
    });

    await router.route({ ...BASE, type: "agent.interrupt" });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("agent.interrupt");
  });
});
