import { describe, expect, it } from "vitest";

import { nextBackoffDelayMs, withReconnect, type ReconnectSession } from "../src/reconnect.js";

describe("reconnect", () => {
  it("calculates exponential backoff with jitter", () => {
    const first = nextBackoffDelayMs(0, { minDelayMs: 1000, maxDelayMs: 30000, random: () => 0.5 });
    const second = nextBackoffDelayMs(1, { minDelayMs: 1000, maxDelayMs: 30000, random: () => 0.5 });

    expect(first).toBe(1000);
    expect(second).toBe(2000);
  });

  it("retries failed connections until cancel", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const controller = withReconnect(
      async (): Promise<ReconnectSession> => {
        attempts += 1;
        throw new Error("network");
      },
      {
        minDelayMs: 100,
        maxDelayMs: 1000,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
          if (sleeps.length === 2) {
            await controller.cancel();
          }
        }
      }
    );

    await controller.done;

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([100, 200]);
  });

  it("stops when close policy rejects reconnect", async () => {
    let attempts = 0;
    const controller = withReconnect(
      async (): Promise<ReconnectSession> => {
        attempts += 1;
        return {
          closed: Promise.resolve({ code: 4003, reason: "connection_replaced" }),
          shouldReconnect: (event) => event.code !== 4003
        };
      },
      { minDelayMs: 100, maxDelayMs: 1000, sleep: async () => undefined }
    );

    await controller.done;

    expect(attempts).toBe(1);
  });
});
