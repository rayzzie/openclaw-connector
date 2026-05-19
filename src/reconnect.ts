import type { Logger } from "./logger.js";

export type ReconnectClose = {
  code?: number;
  reason?: string;
};

export type ReconnectSession = {
  closed: Promise<ReconnectClose>;
  close?: () => Promise<void>;
  shouldReconnect?: (event: ReconnectClose) => boolean;
};

export type ReconnectOptions = {
  minDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
  logger?: Logger;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ReconnectController = {
  done: Promise<void>;
  cancel: () => Promise<void>;
};

export function nextBackoffDelayMs(
  attempt: number,
  options: Pick<ReconnectOptions, "minDelayMs" | "maxDelayMs" | "jitterRatio" | "random">
): number {
  const jitterRatio = options.jitterRatio ?? 0.1;
  const random = options.random ?? Math.random;
  const base = Math.min(options.maxDelayMs, options.minDelayMs * 2 ** attempt);
  const jitter = 1 + (random() * 2 - 1) * jitterRatio;
  return Math.max(0, Math.round(base * jitter));
}

export function withReconnect(connectFn: () => Promise<ReconnectSession>, options: ReconnectOptions): ReconnectController {
  let cancelled = false;
  let activeSession: ReconnectSession | undefined;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const done = (async () => {
    let attempt = 0;
    while (!cancelled) {
      try {
        activeSession = await connectFn();
        attempt = 0;
        const closeEvent = await activeSession.closed;
        if (cancelled) {
          return;
        }
        if (activeSession.shouldReconnect && !activeSession.shouldReconnect(closeEvent)) {
          options.logger?.info("reconnect stopped by close policy", {
            code: closeEvent.code ?? null,
            reason: closeEvent.reason ?? null
          });
          return;
        }
        options.logger?.warn("connection closed; reconnect scheduled", {
          code: closeEvent.code ?? null,
          reason: closeEvent.reason ?? null
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        options.logger?.warn("connect attempt failed; reconnect scheduled", {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const delayMs = nextBackoffDelayMs(attempt, options);
      attempt += 1;
      await sleep(delayMs);
    }
  })();

  return {
    done,
    cancel: async () => {
      cancelled = true;
      await activeSession?.close?.();
    }
  };
}
