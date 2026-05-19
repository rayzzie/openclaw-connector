import { loadConfig } from "./config.js";
import { GatewayClient } from "./gatewayClient.js";
import { Logger, parseLogLevel } from "./logger.js";
import { GatewayWebSocketTransport } from "./wsTransport.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHeartbeatLoop(client: GatewayClient, sessionToken: string, initialDelaySec: number): Promise<void> {
  let nextDelaySec = initialDelaySec;
  while (true) {
    await sleep(nextDelaySec * 1000);
    const heartbeat = await client.heartbeat(sessionToken);
    new Logger("debug").debug("heartbeat sent", { next_heartbeat_in_sec: heartbeat.next_heartbeat_in_sec });
    nextDelaySec = heartbeat.next_heartbeat_in_sec;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(parseLogLevel(config.logLevel));
  const client = new GatewayClient(config);
  const registration = await client.registerRuntime();
  logger.info("connector registered", {
    agent_id: config.agentId,
    gateway_base_url: config.gatewayBaseUrl,
    protocol_version: config.protocolVersion,
    ttl_sec: registration.ttl_sec
  });

  const heartbeat = await client.heartbeat(registration.session_token);
  logger.info("initial heartbeat sent", { next_heartbeat_in_sec: heartbeat.next_heartbeat_in_sec });
  void runHeartbeatLoop(client, registration.session_token, heartbeat.next_heartbeat_in_sec);

  const transport = new GatewayWebSocketTransport(config, logger);
  await transport.connect(registration.session_token);
}

main().catch((error: unknown) => {
  const logger = new Logger("error");
  logger.error("connector failed", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
