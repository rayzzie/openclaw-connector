import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "connector configured",
      agent_id: config.agentId,
      gateway_base_url: config.gatewayBaseUrl,
      protocol_version: config.protocolVersion
    })
  );
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
