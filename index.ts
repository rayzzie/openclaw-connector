import { defineChannelPluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { setRuntime } from "./src/plugin-runtime.js";
import type { GatewayResult, RegisterRuntimeResponse, HeartbeatResponse, RegisterRuntimePayload, AgentLoad } from "./src/runtime.js";
import { uniagentgateChannelPlugin } from "./src/channel.js";
import { acquireRuntimeStart } from "./src/runtime-start-guard.js";

export default defineChannelPluginEntry({
  id: "uniagentgate",
  name: "uniAgentGate",
  description: "Bridges OpenClaw to uniAgentGate (5G RCS + SIP video calls).",
  plugin: uniagentgateChannelPlugin,
  setRuntime,
  registerFull: async (api: OpenClawPluginApi): Promise<void> => {
    if (process.env.UAG_OPENCLAW_INSTALL_ONLY === "1") {
      api.logger?.info("uniagentgate install-only mode; skipping runtime start");
      return;
    }
    const [
      { resolveRuntimePluginConfig },
      { configFromPlugin },
      { ConnectorRuntime },
      { InboundHandler },
      { GatewayWebSocketTransport },
      { Logger },
      { createDesktopFrameProvider },
    ] = await Promise.all([
      import("./src/plugin-config.js"),
      import("./src/config.js"),
      import("./src/runtime.js"),
      import("./src/inbound-handler.js"),
      import("./src/gateway-ws-client.js"),
      import("./src/logger.js"),
      import("./src/desktop-frame-provider.js"),
    ]);
    const pluginConfig = resolveRuntimePluginConfig(api.pluginConfig, api.config);
    const config = configFromPlugin(pluginConfig);
    const startLease = acquireRuntimeStart(`${config.gatewayBaseUrl}|${config.agentId}`);

    const logger = new Logger("info");
    if (api.logger) {
      const apiLogger = api.logger;
      const fmt = (message: string, fields?: Record<string, unknown>) =>
        fields && Object.keys(fields).length ? `${message} ${JSON.stringify(fields)}` : message;
      Object.assign(logger, {
        debug: (message: string, fields?: Record<string, unknown>) => apiLogger.debug(fmt(message, fields)),
        info:  (message: string, fields?: Record<string, unknown>) => apiLogger.info(fmt(message, fields)),
        warn:  (message: string, fields?: Record<string, unknown>) => apiLogger.warn(fmt(message, fields)),
        error: (message: string, fields?: Record<string, unknown>) => apiLogger.error(fmt(message, fields)),
      });
    }
    if (!startLease.acquired) {
      logger.info("uniagentgate connector already running; skipping duplicate runtime start", {
        agent_id: config.agentId,
      });
      return;
    }

    let currentSend: (m: object) => Promise<void> = async () => {
      logger.warn("agent.event dropped — transport not yet connected");
    };

    const desktopFrameProvider = createDesktopFrameProvider(
      {
        provider: (process.env.UAG_DESKTOP_FRAME_PROVIDER ?? "fake") as "screen" | "fake",
        ttlMs: parseEnvInt(process.env.UAG_DESKTOP_FRAME_TTL_MS, 2000),
      },
      logger,
    );
    const desktopFrameStreamOptions = {
      fps: parseEnvFloat(process.env.UAG_DESKTOP_FRAME_FPS, 1),
    };

    const inboundHandler = new InboundHandler(
      { send: (m) => currentSend(m) },
      api.runtime,
      config.agentId,
      logger,
      api.config,
      desktopFrameProvider,
      desktopFrameStreamOptions,
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
      onChannelSessionStarted: (msg) => inboundHandler.handleSessionStarted(msg),
      onChannelSessionEnded: (msg) => inboundHandler.handleSessionEnded(msg),
    });

    void connectorRuntime.start()
      .catch((err: unknown) => {
        logger.error("uniagentgate connector crashed", { error: String(err) });
      })
      .finally(() => startLease.release());
  },
});

function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseEnvFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

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
