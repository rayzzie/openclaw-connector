import "dotenv/config";
import { configFromPlugin, maskSecret } from "./config.js";
import { GatewayHttpClient } from "./gateway-http-client.js";
import { Logger } from "./logger.js";
import { ConnectorRuntime } from "./runtime.js";
import { resolvePluginConfig } from "./plugin-config.js";

function loadPluginConfigFromEnv() {
  const gatewayUrl = process.env["UAG_GATEWAY_BASE_URL"] || "http://127.0.0.1:8080";
  const agentId = process.env["UAG_AGENT_ID"];
  const agentSk = process.env["UAG_AGENT_SK"];
  if (!agentId) throw new Error("Missing required environment variable: UAG_AGENT_ID");
  if (!agentSk) throw new Error("Missing required environment variable: UAG_AGENT_SK");
  return resolvePluginConfig({ gatewayUrl, agentId, agentSk });
}

async function main(): Promise<void> {
  const pluginConfig = loadPluginConfigFromEnv();
  const config = configFromPlugin(pluginConfig);
  const logger = new Logger("info");
  logger.info("connector starting", {
    agent_id: config.agentId,
    gateway_base_url: config.gatewayBaseUrl,
    protocol_version: config.protocolVersion,
    agent_sk: maskSecret(config.agentSk),
  });
  const runtime = new ConnectorRuntime(config, new GatewayHttpClient(config), logger);

  const exit = () => { void runtime.stop("signal"); };
  process.once("SIGINT", exit);
  process.once("SIGTERM", exit);

  await runtime.start();
}

main().catch((error: unknown) => {
  const logger = new Logger("error");
  logger.error("connector failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
