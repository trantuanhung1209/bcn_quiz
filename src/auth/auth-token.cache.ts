import { createHash } from 'node:crypto';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * In-memory TTL cache with in-flight request coalescing.
 * Used to avoid calling Profiles /auth/me on every protected request.
 */
export class AuthTokenCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  static hashCredentials(parts: Array<string | undefined>): string {
    const material = parts
      .map((part) => part?.trim() ?? '')
      .join('\0');

    return createHash('sha256').update(material).digest('hex');
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh insertion order for simple LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
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

    this.evictIfNeeded();
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.store.size;
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }
}
