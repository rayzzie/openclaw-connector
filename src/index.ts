import { loadConfig } from "./config.js";
import { GatewayClient } from "./gatewayClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHeartbeatLoop(client: GatewayClient, sessionToken: string, initialDelaySec: number): Promise<void> {
  let nextDelaySec = initialDelaySec;
  while (true) {
    await sleep(nextDelaySec * 1000);
    const heartbeat = await client.heartbeat(sessionToken);
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "heartbeat sent",
        next_heartbeat_in_sec: heartbeat.next_heartbeat_in_sec
      })
    );
    nextDelaySec = heartbeat.next_heartbeat_in_sec;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new GatewayClient(config);
  const registration = await client.registerRuntime();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "connector registered",
      agent_id: config.agentId,
      gateway_base_url: config.gatewayBaseUrl,
      protocol_version: config.protocolVersion,
      ttl_sec: registration.ttl_sec
    })
  );

  const heartbeat = await client.heartbeat(registration.session_token);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "initial heartbeat sent",
      next_heartbeat_in_sec: heartbeat.next_heartbeat_in_sec
    })
  );
  await runHeartbeatLoop(client, registration.session_token, heartbeat.next_heartbeat_in_sec);
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "connector failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
});
