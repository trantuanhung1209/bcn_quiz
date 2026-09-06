type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

/**
 * Tiny in-memory TTL cache for shared catalog GET responses.
 * Singleton so catalog writes can invalidate the same store GETs read.
 */
export class GetResponseCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number = Number(process.env.GET_CACHE_TTL_MS ?? 20_000),
    private readonly maxEntries: number = Number(
      process.env.GET_CACHE_MAX_ENTRIES ?? 500,
    ),
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

  /** Drop every shared catalog entry. */
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
