import type { GraphData } from '../types/graph'

interface CacheEntry<T> {
  data: T
  timestamp: number
  size: number
}

interface CacheMetrics {
  hits: number
  misses: number
  totalRequests: number
  totalSize: number
  entryCount: number
}

type CrossScopeSlug = 'plain' | 'cross'

type GraphCacheKey =
  | `session-${number}-${number}-prod`
  | `session-${number}-${number}-scenario-${string}`
  | `bunk-${number}-${number}-${number}-prod-${CrossScopeSlug}`
  | `bunk-${number}-${number}-${number}-scenario-${string}-${CrossScopeSlug}`

/**
 * Service for caching social graph data with automatic expiration and memory management
 */
export class GraphCacheService {
  private cache = new Map<GraphCacheKey, CacheEntry<GraphData>>()
  private readonly maxCacheSize = 50 * 1024 * 1024 // 50MB max cache size
  private readonly cacheExpiration = 15 * 60 * 1000 // 15 minutes
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    totalSize: 0,
    entryCount: 0,
  }

  constructor() {
    // Check for stale entries every minute
    setInterval(() => this.cleanupStaleEntries(), 60 * 1000)

    // Log metrics in development mode
    if (import.meta.env.DEV) {
      setInterval(() => this.logMetrics(), 30 * 1000)
    }
  }

  /**
   * Build the scenario slug used in cache keys. Mirrors
   * `GraphCacheManager._scenario_slug` on the Python side so the two caches
   * stay aligned.
   */
  private scenarioSlug(scenarioId?: string | null): 'prod' | `scenario-${string}` {
    return scenarioId ? `scenario-${scenarioId}` : 'prod'
  }

  /**
   * Get cached session graph or fetch new data.
   *
   * The cache key is scoped by scenario so a scenario-sourced graph never
   * collides with the production (CampMinder) graph for the same session+year.
   * When `scenarioId` is null/undefined the prod slot is used.
   */
  async getSessionGraph(
    sessionCmId: number,
    fetcher: () => Promise<GraphData>,
    year: number,
    scenarioId?: string | null
  ): Promise<GraphData> {
    const key: GraphCacheKey = `session-${sessionCmId}-${year}-${this.scenarioSlug(scenarioId)}`
    return this.getOrFetch(key, fetcher)
  }

  /**
   * Get cached bunk graph or fetch new data.
   *
   * The cache key is scoped by scenario so a scenario-sourced bunk graph
   * never collides with the production (CampMinder) bunk graph for the same
   * bunk+session+year. When `scenarioId` is null/undefined the prod slot is
   * used.
   *
   * `showCrossScopeEdges` is also part of the key: the cross-scope response
   * carries extra ghost nodes/edges that the plain response lacks, so the two
   * must occupy distinct cache slots. Omitting it from the key collided the
   * open-then-toggle path — the React Query key flipped but this inner LRU hit
   * the stale plain entry and cross-scope edges never rendered (#1606/#1610).
   */
  async getBunkGraph(
    bunkCmId: number,
    sessionCmId: number,
    fetcher: () => Promise<GraphData>,
    year: number,
    scenarioId?: string | null,
    showCrossScopeEdges = false
  ): Promise<GraphData> {
    const crossSlug: CrossScopeSlug = showCrossScopeEdges ? 'cross' : 'plain'
    const key: GraphCacheKey = `bunk-${bunkCmId}-${sessionCmId}-${year}-${this.scenarioSlug(scenarioId)}-${crossSlug}`
    return this.getOrFetch(key, fetcher)
  }

  /**
   * Invalidate all cached data for a session
   */
  invalidate(sessionCmId: number): void {
    // Remove all session and bunk graphs for this session.
    // Session entries: `session-{id}-{year}-prod` or `session-{id}-{year}-scenario-{id}`.
    // Bunk entries: `bunk-{bunkId}-{sessionCmId}-{year}-{slug}-{crossSlug}`.
    const sessionPrefix = `session-${sessionCmId}-`

    for (const key of this.cache.keys()) {
      if (key.startsWith(sessionPrefix)) {
        this.removeEntry(key)
      } else if (key.startsWith('bunk-')) {
        // bunk-{bunkId}-{sessionCmId}-{year}-{slug}-{crossSlug}: match sessionCmId by position
        const segments = key.split('-')
        // segments = ['bunk', bunkId, sessionCmId, year, ...slug, crossSlug]
        if (segments.length >= 5 && segments[2] === String(sessionCmId)) {
          this.removeEntry(key)
        }
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Invalidated session ${sessionCmId}`)
    }
  }

  /**
   * Invalidate cached data for a specific bunk
   */
  invalidateBunk(bunkCmId: number, sessionCmId: number): void {
    // Remove all scenario-aware keys for this bunk+session.
    const bunkPrefix = `bunk-${bunkCmId}-${sessionCmId}-`
    for (const key of this.cache.keys()) {
      if (key.startsWith(bunkPrefix)) {
        this.removeEntry(key)
      }
    }

    // Also invalidate the session graph as it includes this bunk
    this.invalidate(sessionCmId)
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    const previousSize = this.metrics.totalSize
    this.cache.clear()
    this.metrics.totalSize = 0
    this.metrics.entryCount = 0

    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Cleared cache, freed ${this.formatSize(previousSize)}`)
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  // Private helper methods

  private async getOrFetch(
    key: GraphCacheKey,
    fetcher: () => Promise<GraphData>
  ): Promise<GraphData> {
    this.metrics.totalRequests++

    const cached = this.cache.get(key)
    if (cached && !this.isExpired(cached)) {
      this.metrics.hits++
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Cache hit for ${key}`)
      }
      return cached.data
    }

    this.metrics.misses++
    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Cache miss for ${key}, fetching...`)
    }

    try {
      const data = await fetcher()
      this.store(key, data)
      return data
    } catch (error) {
      console.error(`[GraphCache] Failed to fetch data for ${key}:`, error)
      throw error
    }
  }

  private store(key: GraphCacheKey, data: GraphData): void {
    const size = this.estimateSize(data)

    // Check if we need to evict entries to make room
    while (this.metrics.totalSize + size > this.maxCacheSize && this.cache.size > 0) {
      this.evictOldest()
    }

    const entry: CacheEntry<GraphData> = {
      data,
      timestamp: Date.now(),
      size,
    }

    this.cache.set(key, entry)
    this.metrics.totalSize += size
    this.metrics.entryCount = this.cache.size
  }

  private removeEntry(key: GraphCacheKey): void {
    const entry = this.cache.get(key)
    if (entry) {
      this.cache.delete(key)
      this.metrics.totalSize -= entry.size
      this.metrics.entryCount = this.cache.size
    }
  }

  private isExpired(entry: CacheEntry<GraphData>): boolean {
    return Date.now() - entry.timestamp > this.cacheExpiration
  }

  private cleanupStaleEntries(): void {
    let removedCount = 0
    let freedSize = 0

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key)
        freedSize += entry.size
        removedCount++
      }
    }

    if (removedCount > 0) {
      this.metrics.totalSize -= freedSize
      this.metrics.entryCount = this.cache.size
      if (import.meta.env.DEV) {
        console.log(
          `[GraphCache] Cleaned up ${removedCount} expired entries, freed ${this.formatSize(freedSize)}`
        )
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: GraphCacheKey | null = null
    let oldestTime = Date.now()

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.removeEntry(oldestKey)
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Evicted ${oldestKey} to make room`)
      }
    }
  }

  private estimateSize(data: GraphData): number {
    let size = 0

    size += data.nodes.length * 200
    size += data.edges.length * 100
    size += Object.keys(data.metrics).length * 50

    // `communities` is session-only; the bunk endpoint omits it.
    const communityEntries = Object.entries(data.communities ?? {})
    size += communityEntries.reduce((acc, [_, members]) => acc + members.length * 8, 0)

    return size
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
  }

  private logMetrics(): void {
    if (import.meta.env.DEV) {
      const hitRate =
        this.metrics.totalRequests > 0
          ? ((this.metrics.hits / this.metrics.totalRequests) * 100).toFixed(1)
          : '0.0'

      console.log(
        `[GraphCache] Metrics - Hit Rate: ${hitRate}%, ` +
          `Entries: ${this.metrics.entryCount}, ` +
          `Size: ${this.formatSize(this.metrics.totalSize)}, ` +
          `Requests: ${this.metrics.totalRequests} (${this.metrics.hits} hits, ${this.metrics.misses} misses)`
      )
    }
  }
}

// Export singleton instance
export const graphCacheService = new GraphCacheService()
