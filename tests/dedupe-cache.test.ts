import { describe, expect, it } from "vitest";

import { DedupeCache } from "../src/dedupe-cache.js";

describe("DedupeCache", () => {
  it("stores and returns ack responses", () => {
    const cache = new DedupeCache({ ttlMs: 1000, maxEntries: 100 });
    const ack = { type: "ack", in_reply_to: "msg_001" };

    cache.add("msg_001", ack, 100);

    expect(cache.has("msg_001", 101)).toBe(true);
    expect(cache.get("msg_001", 101)).toEqual(ack);
  });

  it("expires entries after ttl", () => {
    const cache = new DedupeCache({ ttlMs: 10, maxEntries: 100 });
    cache.add("msg_001", { type: "ack" }, 100);

    expect(cache.has("msg_001", 111)).toBe(false);
  });

  it("evicts least recently updated entries over max size", () => {
    const cache = new DedupeCache({ ttlMs: 1000, maxEntries: 1 });
    cache.add("msg_001", { type: "ack" }, 100);
    cache.add("msg_002", { type: "ack" }, 101);

    expect(cache.has("msg_001", 102)).toBe(false);
    expect(cache.has("msg_002", 102)).toBe(true);
  });
});
