import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { configFromPlugin } from "./config.js";
import { GatewayWebSocketTransport } from "./gateway-ws-client.js";
import { makeGatewayClient } from "./gateway-http-client.js";
import { InboundHandler } from "./inbound-handler.js";
import { Logger } from "./logger.js";
import { resolveRuntimePluginConfig } from "./plugin-config.js";
import { createS3Uploader } from "./s3-uploader.js";
import type { ResolveMediaDeps } from "./outbound-media.js";
import { acquireRuntimeStart } from "./runtime-start-guard.js";
import { ConnectorRuntime, type ConnectorStatus } from "./runtime.js";

export type { ConnectorStatus } from "./runtime.js";

export type LoggerSink = {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
};

/**
 * Build the connector Logger, optionally forwarding to a host-provided sink
 * (OpenClaw `api.logger` for registerFull, or `ctx.log` for gateway.startAccount).
 */
export function createConnectorLogger(sink?: LoggerSink): Logger {
  const logger = new Logger("info");
  if (!sink) {
    return logger;
  }
  const fmt = (message: string, fields?: Record<string, unknown>) =>
    fields && Object.keys(fields).length ? `${message} ${JSON.stringify(fields)}` : message;
  Object.assign(logger, {
    debug: (message: string, fields?: Record<string, unknown>) => sink.debug(fmt(message, fields)),
    info: (message: string, fields?: Record<string, unknown>) => sink.info(fmt(message, fields)),
    warn: (message: string, fields?: Record<string, unknown>) => sink.warn(fmt(message, fields)),
    error: (message: string, fields?: Record<string, unknown>) => sink.error(fmt(message, fields)),
  });
  return logger;
}

export type ConnectorStartInput = {
  runtime: PluginRuntime;
  openclawConfig: unknown;
  pluginConfig?: unknown;
  logger: Logger;
  setStatus?: (status: ConnectorStatus) => void;
  abortSignal?: AbortSignal;
};

export type ConnectorHandle = { stop: () => Promise<void> };

/**
 * Shared connector bootstrap used by both `index.ts` registerFull and
 * `channel.ts` gateway.startAccount. The two entry points provide different
 * inputs (registerFull has `api.runtime`; startAccount sources runtime from the
 * plugin-runtime singleton and reads config from `ctx.cfg`), so this function
 * takes a normalized input and owns the run-once lease, transport wiring, and
 * abort handling.
 */
export function startConnectorRuntime(input: ConnectorStartInput): ConnectorHandle {
  const { runtime, openclawConfig, pluginConfig, logger, setStatus, abortSignal } = input;

  const resolved = resolveRuntimePluginConfig(pluginConfig, openclawConfig);
  const config = configFromPlugin(resolved);

  const startLease = acquireRuntimeStart(`${config.gatewayBaseUrl}|${config.agentId}`);
  if (!startLease.acquired) {
    logger.info("uniagentgate connector already running; skipping duplicate runtime start", {
      agent_id: config.agentId,
    });
    return { stop: async () => {} };
  }

  let currentSend: (m: object) => Promise<void> = async () => {
    logger.warn("agent.event dropped — transport not yet connected");
  };

  const mediaDeps: ResolveMediaDeps = resolved.oss
    ? { uploader: createS3Uploader(resolved.oss) }
    : {};
  logger.info("outbound media upload", {
    oss: resolved.oss ? `${resolved.oss.endpoint}/${resolved.oss.bucket}` : "not configured",
  });

  const inboundHandler = new InboundHandler(
    { send: (m) => currentSend(m) },
    runtime,
    config.agentId,
    logger,
    openclawConfig,
    mediaDeps,
  );

  const gatewayClient = makeGatewayClient(resolved.gatewayUrl);

  const connectorRuntime = new ConnectorRuntime(config, gatewayClient, logger, {
    transportFactory: () => {
      const transport = new GatewayWebSocketTransport(config, logger);
      currentSend = (m) => transport.send(m);
      return transport;
    },
    onAgentRequest: (msg) => inboundHandler.handle(msg),
    onAgentInterrupt: async (msg) => {
      inboundHandler.interrupt(msg);
    },
    onStatus: setStatus,
  });

  void connectorRuntime
    .start()
    .catch((err: unknown) => {
      logger.error("uniagentgate connector crashed", { error: String(err) });
      setStatus?.({ state: "error", detail: "crashed" });
    })
    .finally(() => startLease.release());

  const stop = async (): Promise<void> => {
    await connectorRuntime.stop("gateway_stop");
    startLease.release();
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      void stop();
    } else {
      abortSignal.addEventListener("abort", () => void stop(), { once: true });
    }
  }

  return { stop };
}
