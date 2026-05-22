import type { ConnectorConfig } from "./config.js";
import { AckTracker } from "./ack-tracker.js";
import { DedupeCache } from "./dedupe-cache.js";
import { EnvelopeRouter } from "./envelope-router.js";
import type {
  AgentLoad,
  GatewayResult,
  HeartbeatResponse,
  RegisterRuntimePayload,
  RegisterRuntimeResponse
} from "./gateway-http-client.js";
import type { Logger } from "./logger.js";
import { MockAgent } from "./mock-agent.js";
import type { Envelope } from "./protocol.js";
import { withReconnect, type ReconnectClose, type ReconnectController } from "./reconnect.js";
import { GatewayWebSocketTransport, type WsCloseEvent } from "./ws-client.js";

export type RuntimeOptions = {
  sleep?: (ms: number) => Promise<void>;
  transportFactory?: () => RuntimeTransport;
};

export type RuntimeGatewayClient = {
  register(agentId: string, sk: string, payload: RegisterRuntimePayload): Promise<GatewayResult<RegisterRuntimeResponse>>;
  heartbeat(sessionToken: string, agentId: string, load: AgentLoad): Promise<GatewayResult<HeartbeatResponse>>;
};

export type RuntimeTransport = {
  connect(sessionToken: string): Promise<void>;
  send(message: object): Promise<void>;
  onMessage(handler: (message: Envelope) => void): void;
  close(code: number, reason: string): Promise<void>;
  once(event: "close", handler: (event: WsCloseEvent) => void): unknown;
};

export class ConnectorRuntime {
  private stopped = false;
  private activeHeartbeat: HeartbeatLoop | undefined;
  private reconnectController: ReconnectController | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly config: ConnectorConfig,
    private readonly client: RuntimeGatewayClient,
    private readonly logger: Logger,
    private readonly options: RuntimeOptions = {}
  ) {
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  installSignalHandlers(): void {
    const exit = () => {
      void this.stop("signal");
    };
    process.once("SIGINT", exit);
    process.once("SIGTERM", exit);
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      const registration = await this.registerWithRetry();
      if (!registration) {
        return;
      }

      let needsRegister = false;
      const markNeedsRegister = () => {
        needsRegister = true;
      };
      const intervalSec = heartbeatIntervalSec(this.config.heartbeatIntervalSec, registration.ttl_sec);
      this.startHttpHeartbeat(registration.session_token, intervalSec, markNeedsRegister);
      this.startWebSocketLoop(
        registration.session_token,
        () => {
          this.stopHttpHeartbeat();
        },
        () => {
          this.startHttpHeartbeat(registration.session_token, intervalSec, markNeedsRegister);
        }
      );

      while (!this.stopped && !needsRegister) {
        await this.sleep(100);
      }
      await this.reconnectController?.cancel();
      this.stopHttpHeartbeat();
    }
  }

  async stop(reason: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.logger.info("exiting", { reason });
    this.stopHttpHeartbeat();
    await this.reconnectController?.cancel();
  }

  private async registerWithRetry(): Promise<RegisterRuntimeResponse | undefined> {
    let serverErrorAttempts = 0;
    while (!this.stopped) {
      const result = await this.client.register(this.config.agentId, this.config.agentSk, {
        version: this.config.agentVersion,
        capabilities: this.config.capabilities,
        endpoint_url: this.config.endpointUrl
      });
      if (result.ok) {
        this.logger.info("connector registered", {
          agent_id: this.config.agentId,
          ttl_sec: result.value.ttl_sec
        });
        return result.value;
      }
      this.logger.warn("register failed", {
        status: result.error.status,
        code: result.error.code,
        message: result.error.message
      });
      if (result.error.status >= 400 && result.error.status < 500) {
        return undefined;
      }
      serverErrorAttempts += 1;
      if (serverErrorAttempts >= 3) {
        return undefined;
      }
      await this.sleep(1000 * serverErrorAttempts);
    }
    return undefined;
  }

  private startHttpHeartbeat(sessionToken: string, intervalSec: number, onNeedsRegister: () => void): void {
    if (this.activeHeartbeat) {
      return;
    }
    // HTTP heartbeat is a fallback lease renewal. Once WS is accepted, WS
    // heartbeat renews the same Gateway lease and this loop is stopped, so we
    // do not double-send lease traffic while the real-time channel is healthy.
    const loop = new HeartbeatLoop(this.config, this.client, this.logger, sessionToken, intervalSec, onNeedsRegister, this.sleep);
    this.activeHeartbeat = loop;
    loop.start();
  }

  private stopHttpHeartbeat(): void {
    this.activeHeartbeat?.stop();
    this.activeHeartbeat = undefined;
  }

  private startWebSocketLoop(sessionToken: string, onConnected: () => void, onDisconnected: () => void): void {
    this.reconnectController = withReconnect(
      async () => {
        const transport = this.options.transportFactory?.() ?? new GatewayWebSocketTransport(this.config, this.logger);
        const ackTracker = new AckTracker({ ackDeadlineMs: this.config.ackDeadlineMs, ackMaxRetries: this.config.ackMaxRetries });
        const mockAgent = new MockAgent({
          mode: this.config.mockMode,
          ackTracker,
          send: (message) => transport.send(message),
          close: (code, reason) => transport.close(code, reason),
          sleep: this.sleep,
          screenshotUrl: this.config.screenshotUrl,
          screenshotChromePath: this.config.screenshotChromePath,
          screenshotWaitMs: this.config.screenshotWaitMs,
          screenshotQuality: this.config.screenshotQuality,
          screenshotRefreshMs: this.config.screenshotRefreshMs,
        });
        const router = new EnvelopeRouter({
          transport,
          ackTracker,
          dedupeCache: new DedupeCache(),
          dropAgentRequestAck: this.config.mockMode === "ack_drop",
          onAgentRequest: (message) => mockAgent.handleRequest(message)
        });
        transport.onMessage((message: Envelope) => {
          void router.route(message);
        });
        const closed = new Promise<WsCloseEvent>((resolve) => {
          transport.once("close", resolve);
        });
        await transport.connect(sessionToken);
        onConnected();
        return {
          closed,
          close: () => transport.close(1000, "runtime_stop"),
          shouldReconnect: (event: ReconnectClose) => {
            if (event.code === 4003) {
              this.stopped = true;
              this.stopHttpHeartbeat();
              this.logger.info("exiting", { reason: "connection_replaced" });
              return false;
            }
            onDisconnected();
            return true;
          }
        };
      },
      {
        minDelayMs: this.config.connectRetryMinMs,
        maxDelayMs: this.config.connectRetryMaxMs,
        logger: this.logger,
        sleep: this.sleep
      }
    );
  }
}

class HeartbeatLoop {
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly config: ConnectorConfig,
    private readonly client: RuntimeGatewayClient,
    private readonly logger: Logger,
    private readonly sessionToken: string,
    private readonly intervalSec: number,
    private readonly onNeedsRegister: () => void,
    private readonly sleep: (ms: number) => Promise<void>
  ) {}

  start(): void {
    void this.run();
  }

  stop(): void {
    this.stopped = true;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      await this.sleep(this.intervalSec * 1000);
      if (this.stopped) {
        return;
      }
      const result: GatewayResult<HeartbeatResponse> = await this.client.heartbeat(this.sessionToken, this.config.agentId, { active_sessions: 0 });
      if (result.ok) {
        this.failures = 0;
        this.logger.debug("http heartbeat sent", { next_heartbeat_in_sec: result.value.next_heartbeat_in_sec });
        continue;
      }
      this.failures += 1;
      this.logger.warn("http heartbeat failed", {
        status: result.error.status,
        code: result.error.code,
        failures: this.failures
      });
      if (result.error.status === 401 || this.failures >= 3) {
        this.onNeedsRegister();
        return;
      }
    }
  }
}

export function heartbeatIntervalSec(configuredIntervalSec: number, ttlSec: number): number {
  return Math.max(1, Math.min(configuredIntervalSec, Math.floor(ttlSec / 2)));
}
