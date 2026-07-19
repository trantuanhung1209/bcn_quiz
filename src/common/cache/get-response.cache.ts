type CacheEntry = {
  value: unknown;
  /** Soft TTL: after this, entry is stale but still servable. */
  freshUntil: number;
  /** Hard TTL: after this, entry is dropped. */
  staleUntil: number;
};

export type CacheLookup =
  | { hit: 'fresh'; value: unknown }
  | { hit: 'stale'; value: unknown }
  | { hit: 'miss' };

/**
 * Tiny in-memory TTL cache for hot GET responses.
 * Soft-stale window keeps repeat GETs near 0ms server time after first fill.
 */
export class GetResponseCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    /** Extra window after TTL where stale values may still be served. */
    private readonly staleMs: number = Math.max(ttlMs, 30_000),
  ) {}

  lookup(key: string): CacheLookup {
    const entry = this.store.get(key);
    if (!entry) {
      return { hit: 'miss' };
    }

    const now = Date.now();
    if (now >= entry.staleUntil) {
      this.store.delete(key);
      return { hit: 'miss' };
    }

    // Refresh LRU order.
    this.store.delete(key);
    this.store.set(key, entry);

    if (now < entry.freshUntil) {
      return { hit: 'fresh', value: entry.value };
    }

    return { hit: 'stale', value: entry.value };
  }

  /** Convenience for simple callers/tests. */
  get(key: string): unknown | undefined {
    const result = this.lookup(key);
    if (result.hit === 'miss') {
      return undefined;
    }
    return result.value;
  }

  set(key: string, value: unknown): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      return;
    }

    if (this.store.has(key)) {
      this.store.delete(key);
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      freshUntil: now + this.ttlMs,
      staleUntil: now + this.ttlMs + this.staleMs,
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
