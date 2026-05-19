import { loadConfig, maskSecret } from "./config.js";
import { GatewayHttpClient } from "./gateway-http-client.js";
import { Logger, parseLogLevel } from "./logger.js";
import { ConnectorRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(parseLogLevel(config.logLevel));
  logger.info("connector starting", {
    agent_id: config.agentId,
    gateway_base_url: config.gatewayBaseUrl,
    protocol_version: config.protocolVersion,
    agent_sk: maskSecret(config.agentSk)
  });
  const runtime = new ConnectorRuntime(config, new GatewayHttpClient(config), logger);
  runtime.installSignalHandlers();
  await runtime.start();
}

main().catch((error: unknown) => {
  const logger = new Logger("error");
  logger.error("connector failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
