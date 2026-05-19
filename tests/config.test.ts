import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, maskSecret } from "../src/config.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("loadConfig", () => {
  it("loads required fields and defaults", () => {
    process.env.UAG_AGENT_ID = "agent_001";
    process.env.UAG_AGENT_SK = "uag_sk_1234567890";

    const config = loadConfig();

    expect(config.gatewayBaseUrl).toBe("http://127.0.0.1:8080");
    expect(config.agentId).toBe("agent_001");
    expect(config.protocolVersion).toBe("uag.agent.v1");
    expect(config.connectRetryMinMs).toBe(1000);
    expect(config.connectRetryMaxMs).toBe(30000);
    expect(config.heartbeatIntervalSec).toBe(20);
    expect(config.ackDeadlineMs).toBe(3000);
    expect(config.ackMaxRetries).toBe(2);
    expect(config.mockMode).toBe("happy");
    expect(maskSecret(config.agentSk)).toBe("uag_***7890");
  });
});
