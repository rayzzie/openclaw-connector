import { defineChannelPluginEntry, type ChannelPlugin, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { setRuntime } from "./src/plugin-runtime.js";
import { resolvePluginConfig } from "./src/plugin-config.js";
import { configFromPlugin } from "./src/config.js";
import { ConnectorRuntime } from "./src/runtime.js";
import type { GatewayResult, RegisterRuntimeResponse, HeartbeatResponse, RegisterRuntimePayload, AgentLoad } from "./src/runtime.js";
import { InboundHandler } from "./src/inbound-handler.js";
import { GatewayWebSocketTransport } from "./src/gateway-ws-client.js";
import { Logger } from "./src/logger.js";

const uniagentgatePlugin: ChannelPlugin = {
  id: "uniagentgate",
  meta: {
    id: "uniagentgate",
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
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    isConfigured: () => true,
    isEnabled: () => true,
  },
};

export default defineChannelPluginEntry({
  id: "uniagentgate",
  name: "uniAgentGate",
  description: "Bridges OpenClaw to uniAgentGate (5G RCS + SIP video calls).",
  plugin: uniagentgatePlugin,
  setRuntime,
  registerFull: (api: OpenClawPluginApi): void => {
    const pluginConfig = resolvePluginConfig(api.pluginConfig);
    const config = configFromPlugin(pluginConfig);

    const logger = new Logger("info");
    if (api.logger) {
      const apiLogger = api.logger;
      Object.assign(logger, {
        debug: (message: string) => apiLogger.debug(message),
        info: (message: string) => apiLogger.info(message),
        warn: (message: string) => apiLogger.warn(message),
        error: (message: string) => apiLogger.error(message),
      });
    }

    let currentSend: (m: object) => Promise<void> = async () => {
      logger.warn("agent.event dropped — transport not yet connected");
    };

    const inboundHandler = new InboundHandler(
      { send: (m) => currentSend(m) },
      api.runtime,
      config.agentId,
      logger,
    );

    const gatewayClient = makeGatewayClient(pluginConfig.gatewayUrl);

    const connectorRuntime = new ConnectorRuntime(config, gatewayClient, logger, {
      transportFactory: () => {
        const transport = new GatewayWebSocketTransport(config, logger);
        currentSend = (m) => transport.send(m);
        return transport;
      },
      onAgentRequest: (msg) => inboundHandler.handle(msg),
      onAgentInterrupt: async (msg) => { inboundHandler.interrupt(msg); },
    });

    void connectorRuntime.start().catch((err: unknown) => {
      logger.error("uniagentgate connector crashed", { error: String(err) });
    });
  },
});

function makeGatewayClient(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async register(
      agentId: string,
      sk: string,
      payload: RegisterRuntimePayload,
    ): Promise<GatewayResult<RegisterRuntimeResponse>> {
      try {
        const res = await fetch(`${base}/v1/agent-runtimes/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sk}`,
            "X-Agent-Id": agentId,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: { status: res.status, code: "http_error", message: text } };
        }
        return { ok: true, value: await res.json() as RegisterRuntimeResponse };
      } catch (err) {
        return { ok: false, error: { status: 0, code: "network_error", message: String(err) } };
      }
    },

    async heartbeat(
      sessionToken: string,
      agentId: string,
      load: AgentLoad,
    ): Promise<GatewayResult<HeartbeatResponse>> {
      try {
        const res = await fetch(`${base}/v1/agent-runtimes/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
            "X-Agent-Id": agentId,
          },
          body: JSON.stringify(load),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: { status: res.status, code: "http_error", message: text } };
        }
        return { ok: true, value: await res.json() as HeartbeatResponse };
      } catch (err) {
        return { ok: false, error: { status: 0, code: "network_error", message: String(err) } };
      }
    },
  };
}
