type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

/**
 * Tiny in-memory TTL cache for hot GET responses.
 * Aimed at cutting repeat DB round-trips on production (remote Postgres RTT).
 */
export class GetResponseCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh LRU order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      return;
    }

    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
