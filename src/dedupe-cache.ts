export type DedupeCacheOptions = {
  ttlMs: number;
  maxEntries: number;
};

type CacheEntry = {
  ackResponse: object;
  updatedAt: number;
};

export class DedupeCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly options: DedupeCacheOptions = { ttlMs: 300_000, maxEntries: 1000 }) {}

  has(messageId: string, now = Date.now()): boolean {
    this.cleanup(now);
    return this.entries.has(messageId);
  }

  get(messageId: string, now = Date.now()): object | undefined {
    this.cleanup(now);
    return this.entries.get(messageId)?.ackResponse;
  }

  add(messageId: string, ackResponse: object, now = Date.now()): void {
    this.entries.set(messageId, { ackResponse, updatedAt: now });
    this.cleanup(now);
  }

  private cleanup(now: number): void {
    for (const [messageId, entry] of this.entries.entries()) {
      if (now - entry.updatedAt > this.options.ttlMs) {
        this.entries.delete(messageId);
      }
    }
    while (this.entries.size > this.options.maxEntries) {
      const oldest = [...this.entries.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0];
      if (!oldest) {
        return;
      }
      this.entries.delete(oldest[0]);
    }
  }
}
