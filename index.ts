import { defineChannelPluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { setRuntime } from "./src/plugin-runtime.js";
import { uniagentgateChannelPlugin } from "./src/channel.js";

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
    // Dynamic import keeps the heavy runtime modules out of the cold plugin
    // load path; they are only loaded when the connector actually starts.
    const { startConnectorRuntime, createConnectorLogger } = await import("./src/channel-gateway.js");
    startConnectorRuntime({
      runtime: api.runtime,
      openclawConfig: api.config,
      pluginConfig: api.pluginConfig,
      logger: createConnectorLogger(api.logger),
    });
  },
});
