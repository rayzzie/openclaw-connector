import { describe, it, expect } from "vitest";
import { resolvePluginConfig, resolveRuntimePluginConfig } from "../src/plugin-config.js";

describe("resolvePluginConfig", () => {
  it("parses valid config", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://localhost:18080",
      agentId: "agent:main:openclaw",
      agentSk: "uag_sk_abc123",
    });
    expect(cfg.gatewayUrl).toBe("http://localhost:18080");
    expect(cfg.agentId).toBe("agent:main:openclaw");
    expect(cfg.agentSk).toBe("uag_sk_abc123");
  });

  it("strips trailing slash from gatewayUrl", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://localhost:18080/",
      agentId: "agent:main",
      agentSk: "uag_sk_x",
    });
    expect(cfg.gatewayUrl).toBe("http://localhost:18080");
  });

  it("throws on missing gatewayUrl", () => {
    expect(() => resolvePluginConfig({ agentId: "x", agentSk: "y" })).toThrow(/gatewayUrl/);
  });

  it("throws on missing agentId", () => {
    expect(() => resolvePluginConfig({ gatewayUrl: "http://x", agentSk: "y" })).toThrow(/agentId/);
  });

  it("throws on missing agentSk", () => {
    expect(() => resolvePluginConfig({ gatewayUrl: "http://x", agentId: "y" })).toThrow(/agentSk/);
  });

  it("throws on non-object input", () => {
    expect(() => resolvePluginConfig(null)).toThrow();
    expect(() => resolvePluginConfig("string")).toThrow();
  });

  it("leaves oss undefined when not configured", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://x",
      agentId: "a",
      agentSk: "s",
    });
    expect(cfg.oss).toBeUndefined();
  });

  it("parses a complete oss block (region defaults to us-east-1)", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://x",
      agentId: "a",
      agentSk: "s",
      oss: {
        endpoint: "http://obs-nmhhht6.cucloud.cn",
        bucket: "ruanyanyuan-temp",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      },
    });
    expect(cfg.oss).toMatchObject({
      endpoint: "http://obs-nmhhht6.cucloud.cn",
      bucket: "ruanyanyuan-temp",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      region: "us-east-1",
      urlStyle: "path", // default
    });
  });

  it("parses urlStyle=virtual for 联通云 OSS public read", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://x",
      agentId: "a",
      agentSk: "s",
      oss: {
        endpoint: "http://obs-nmhhht6.cucloud.cn",
        bucket: "ruanyanyuan-temp",
        accessKeyId: "AK",
        secretAccessKey: "SK",
        urlStyle: "virtual",
      },
    });
    expect(cfg.oss?.urlStyle).toBe("virtual");
  });

  it("ignores an incomplete oss block (missing keys → undefined)", () => {
    const cfg = resolvePluginConfig({
      gatewayUrl: "http://x",
      agentId: "a",
      agentSk: "s",
      oss: { endpoint: "http://obs", bucket: "b" }, // no credentials
    });
    expect(cfg.oss).toBeUndefined();
  });

  it("resolves runtime config from channel config when plugin config is empty", () => {
    const cfg = resolveRuntimePluginConfig(
      {},
      {
        channels: {
          uniagentgate: {
            gatewayUrl: "http://localhost:18080/",
            agentId: "agent:main",
            agentSk: "uag_sk_channel",
          },
        },
      },
    );

    expect(cfg).toMatchObject({
      gatewayUrl: "http://localhost:18080",
      agentId: "agent:main",
      agentSk: "uag_sk_channel",
    });
  });

  it("keeps legacy plugin config as runtime fallback", () => {
    const cfg = resolveRuntimePluginConfig(
      {
        gatewayUrl: "http://legacy:18080",
        agentId: "agent:legacy",
        agentSk: "uag_sk_legacy",
      },
      { channels: {} },
    );

    expect(cfg.agentId).toBe("agent:legacy");
  });
});
