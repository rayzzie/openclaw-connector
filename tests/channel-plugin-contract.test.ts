import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { uniagentgateChannelPlugin } from "../src/channel.js";

const root = resolve(import.meta.dirname, "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("OpenClaw channel plugin contract", () => {
  it("declares channel manifest metadata for cold-path config and setup", () => {
    const manifest = readJson("openclaw.plugin.json");

    expect(manifest["kind"]).toBe("channel");
    expect(manifest["channels"]).toEqual(["uniagentgate"]);
    expect(manifest["channelConfigs"]).toMatchObject({
      uniagentgate: {
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["gatewayUrl", "agentId", "agentSk"],
          properties: {
            gatewayUrl: { type: "string" },
            agentId: { type: "string" },
            agentSk: { type: "string" },
          },
        },
        uiHints: {
          agentSk: { sensitive: true },
        },
      },
    });
  });

  it("declares a setup entry in package metadata", () => {
    const pkg = readJson("package.json");
    const openclaw = pkg["openclaw"] as Record<string, unknown>;

    expect(openclaw["setupEntry"]).toBe("./dist/setup-entry.js");
  });

  it("inspects channel account config without materializing secrets", () => {
    const account = uniagentgateChannelPlugin.config.resolveAccount(
      {
        channels: {
          uniagentgate: {
            enabled: true,
            gatewayUrl: "http://localhost:18080",
            agentId: "agent_001",
            agentSk: "uag_sk_secret",
          },
        },
      },
      "default",
    );

    expect(account).toEqual({
      accountId: "default",
      enabled: true,
      configured: true,
      tokenStatus: "available",
    });
  });

  it("reports missing required plugin config as unconfigured", () => {
    const account = uniagentgateChannelPlugin.config.resolveAccount({ plugins: { entries: {} } }, "default");

    expect(account).toMatchObject({
      accountId: "default",
      enabled: false,
      configured: false,
      tokenStatus: "missing",
    });
  });

  it("exposes a gateway adapter with startAccount and stopAccount", () => {
    expect(typeof uniagentgateChannelPlugin.gateway?.startAccount).toBe("function");
    expect(typeof uniagentgateChannelPlugin.gateway?.stopAccount).toBe("function");
  });

  it("gateway.startAccount reports error status and a no-op stop when the plugin runtime is unset", async () => {
    const statuses: Array<{ state: string }> = [];
    const ctx = {
      account: { accountId: "default", enabled: true, configured: true, tokenStatus: "available" },
      cfg: {},
      log: { debug() {}, info() {}, warn() {}, error() {} },
      setStatus: (s: { state: string }) => statuses.push(s),
      abortSignal: new AbortController().signal,
    };

    const handle = await uniagentgateChannelPlugin.gateway!.startAccount(ctx as never);

    expect(statuses.some((s) => s.state === "error")).toBe(true);
    expect(typeof handle.stop).toBe("function");
    await handle.stop();
  });
});
