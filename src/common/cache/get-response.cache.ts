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
 * Provided as a singleton so writes can invalidate the same store GETs read.
 */
export class GetResponseCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = Number(process.env.GET_CACHE_TTL_MS ?? 20_000),
    private readonly maxEntries: number = Number(
      process.env.GET_CACHE_MAX_ENTRIES ?? 500,
    ),
    /** Extra window after TTL where stale values may still be served. Default 0 = no soft-stale. */
    private readonly staleMs: number = Number(process.env.GET_CACHE_STALE_MS ?? 0),
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

  /** Drop every shared catalog entry (quiz / topic / course lists). */
  invalidateShared(): number {
    return this.invalidateWhere((key) => key.startsWith('shared:'));
  }

  invalidateWhere(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (predicate(key)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
