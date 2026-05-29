import type { ChannelPlugin, GatewayStartContext, GatewayStopResult } from "openclaw/plugin-sdk/core";
import { getRuntime } from "./plugin-runtime.js";
import type { ConnectorStatus } from "./channel-gateway.js";

const CHANNEL_ID = "uniagentgate";
const DEFAULT_ACCOUNT_ID = "default";

export type UniagentGateAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  tokenStatus: "available" | "missing";
};

export const uniagentgateChannelPlugin: ChannelPlugin<UniagentGateAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "uniAgentGate",
    selectionLabel: "uniAgentGate (RCS + SIP Video)",
    docsPath: "",
    blurb: "Bridge OpenClaw conversations to uniAgentGate channel runtimes.",
    order: 60,
    aliases: ["uniagentgate", "uag"],
  },
  capabilities: {
    chatTypes: ["dm"],
  },
  setup: {
    resolveAccount,
    inspectAccount: resolveAccount,
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount,
    isConfigured: (account) => account.configured,
    isEnabled: (account) => account.enabled,
  },
  gateway: {
    startAccount: async (ctx: GatewayStartContext<UniagentGateAccount>): Promise<GatewayStopResult> => {
      // Lazy import keeps the heavy runtime modules off the cold plugin load path.
      const { startConnectorRuntime, createConnectorLogger } = await import("./channel-gateway.js");
      const logger = createConnectorLogger(ctx.log);

      // gateway.startAccount's ctx carries no PluginRuntime; it comes from the
      // setRuntime() singleton. Without it the connector cannot dispatch replies.
      const runtime = getRuntime();
      if (!runtime) {
        logger.error("gateway.startAccount: plugin runtime not set; cannot start connector");
        ctx.setStatus({ state: "error", detail: "runtime_not_set" });
        return { stop: async () => {} };
      }

      const handle = startConnectorRuntime({
        runtime,
        openclawConfig: ctx.cfg,
        logger,
        setStatus: (status: ConnectorStatus) => ctx.setStatus(status),
        abortSignal: ctx.abortSignal,
      });
      return { stop: () => handle.stop() };
    },
    stopAccount: async (): Promise<void> => {
      // Shutdown is driven by ctx.abortSignal wired into startConnectorRuntime.
    },
  },
};

function resolveAccount(cfg: unknown, accountId?: string | null): UniagentGateAccount {
  const channelConfig = readChannelConfig(cfg);
  const entry = readPluginEntry(cfg);
  const configured = hasRequiredPluginConfig(channelConfig) || hasRequiredPluginConfig(entry?.config);
  const enabled =
    channelConfig?.["enabled"] !== false &&
    entry?.enabled !== false &&
    configured;

  return {
    accountId: accountId ?? DEFAULT_ACCOUNT_ID,
    enabled,
    configured,
    tokenStatus: configured ? "available" : "missing",
  };
}

function readChannelConfig(cfg: unknown): Record<string, unknown> | undefined {
  if (!isRecord(cfg)) {
    return undefined;
  }
  const channels = cfg["channels"];
  if (!isRecord(channels)) {
    return undefined;
  }
  const channel = channels[CHANNEL_ID];
  return isRecord(channel) ? channel : undefined;
}

function readPluginEntry(cfg: unknown): { enabled?: boolean; config?: unknown } | undefined {
  if (!isRecord(cfg)) {
    return undefined;
  }
  const plugins = cfg["plugins"];
  if (!isRecord(plugins)) {
    return undefined;
  }
  const entries = plugins["entries"];
  if (!isRecord(entries)) {
    return undefined;
  }
  const entry = entries[CHANNEL_ID];
  return isRecord(entry) ? entry : undefined;
}

function hasRequiredPluginConfig(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["gatewayUrl"] === "string" &&
    value["gatewayUrl"].length > 0 &&
    typeof value["agentId"] === "string" &&
    value["agentId"].length > 0 &&
    typeof value["agentSk"] === "string" &&
    value["agentSk"].length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
