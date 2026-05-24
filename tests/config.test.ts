import { describe, it, expect } from "vitest";
import { configFromPlugin, maskSecret } from "../src/config.js";
import type { PluginConfig } from "../src/plugin-config.js";

const pluginConfig: PluginConfig = {
  gatewayUrl: "http://localhost:18080",
  agentId: "agent:main:openclaw",
  agentSk: "uag_sk_abc123xyz",
};

describe("configFromPlugin", () => {
  it("maps gatewayUrl to gatewayBaseUrl", () => {
    const cfg = configFromPlugin(pluginConfig);
    expect(cfg.gatewayBaseUrl).toBe("http://localhost:18080");
  });

  it("copies agentId and agentSk", () => {
    const cfg = configFromPlugin(pluginConfig);
    expect(cfg.agentId).toBe("agent:main:openclaw");
    expect(cfg.agentSk).toBe("uag_sk_abc123xyz");
  });

  it("sets sensible defaults", () => {
    const cfg = configFromPlugin(pluginConfig);
    expect(cfg.connectRetryMinMs).toBe(1000);
    expect(cfg.connectRetryMaxMs).toBe(30000);
    expect(cfg.heartbeatIntervalSec).toBe(20);
    expect(cfg.ackDeadlineMs).toBe(3000);
    expect(cfg.ackMaxRetries).toBe(2);
  });
});

describe("maskSecret", () => {
  it("masks long secrets", () => {
    expect(maskSecret("uag_sk_abc123xyz")).toBe("uag_***3xyz");
  });

  it("fully masks short secrets", () => {
    expect(maskSecret("short")).toBe("***");
  });
});
