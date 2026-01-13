import type { GraphData } from '../types/graph';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  size: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  totalRequests: number;
  totalSize: number;
  entryCount: number;
}

type GraphCacheKey = `session-${number}` | `bunk-${number}-${number}` | `ego-${number}`;

/**
 * Service for caching social graph data with automatic expiration and memory management
 */
export class GraphCacheService {
  private cache = new Map<GraphCacheKey, CacheEntry<GraphData>>();
  private readonly maxCacheSize = 50 * 1024 * 1024; // 50MB max cache size
  private readonly cacheExpiration = 15 * 60 * 1000; // 15 minutes
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    totalSize: 0,
    entryCount: 0,
  };

  constructor() {
    // Check for stale entries every minute
    setInterval(() => this.cleanupStaleEntries(), 60 * 1000);
    
    // Log metrics in development mode
    if (import.meta.env.DEV) {
      setInterval(() => this.logMetrics(), 30 * 1000);
    }
  }

  /**
   * Get cached session graph or fetch new data
   */
  async getSessionGraph(
    sessionCmId: number,
    fetcher: () => Promise<GraphData>
  ): Promise<GraphData> {
    const key: GraphCacheKey = `session-${sessionCmId}`;
    return this.getOrFetch(key, fetcher);
  }

  /**
   * Get cached bunk graph or fetch new data
   */
  async getBunkGraph(
    bunkCmId: number,
    sessionCmId: number,
    fetcher: () => Promise<GraphData>
  ): Promise<GraphData> {
    const key: GraphCacheKey = `bunk-${bunkCmId}-${sessionCmId}`;
    return this.getOrFetch(key, fetcher);
  }

  /**
   * Get cached ego network or fetch new data
   */
  async getEgoNetwork(
    personCmId: number,
    fetcher: () => Promise<GraphData>
  ): Promise<GraphData> {
    const key: GraphCacheKey = `ego-${personCmId}`;
    return this.getOrFetch(key, fetcher);
  }

  /**
   * Invalidate all cached data for a session
   */
  invalidate(sessionCmId: number): void {
    const sessionKey: GraphCacheKey = `session-${sessionCmId}`;
    
    // Remove session graph
    this.removeEntry(sessionKey);
    
    // Remove all bunk graphs for this session
    for (const key of this.cache.keys()) {
      if (key.includes(`-${sessionCmId}`)) {
        this.removeEntry(key);
      }
    }
    
    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Invalidated session ${sessionCmId}`);
    }
  }

  /**
   * Invalidate cached data for a specific bunk
   */
  invalidateBunk(bunkCmId: number, sessionCmId: number): void {
    const bunkKey: GraphCacheKey = `bunk-${bunkCmId}-${sessionCmId}`;
    this.removeEntry(bunkKey);
    
    // Also invalidate the session graph as it includes this bunk
    this.invalidate(sessionCmId);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    const previousSize = this.metrics.totalSize;
    this.cache.clear();
    this.metrics.totalSize = 0;
    this.metrics.entryCount = 0;
    
    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Cleared cache, freed ${this.formatSize(previousSize)}`);
    }
  }

  /**
   * Update graph data after a camper move (incremental update)
   */
  async updateForCamperMove(
    sessionCmId: number,
    camperCmId: number,
    fromBunkCmId: number | null,
    toBunkCmId: number | null
  ): Promise<void> {
    const sessionKey: GraphCacheKey = `session-${sessionCmId}`;
    const entry = this.cache.get(sessionKey);
    
    if (!entry) {
      // No cached data to update
      return;
    }
    
    try {
      const graph = entry.data;
      
      // Find the camper node
      const camperNode = graph.nodes.find(n => n.id === camperCmId);
      if (!camperNode) {
        // Camper not in graph, invalidate to force refresh
        this.invalidate(sessionCmId);
        return;
      }
      
      // Update the camper's bunk assignment
      const oldBunkCmId = camperNode.bunk_cm_id;
      camperNode.bunk_cm_id = toBunkCmId;
      
      // Collect all affected nodes (connected nodes + nodes in affected bunks)
      const affectedNodeIds = new Set<number>();
      
      // Add directly connected nodes
      graph.edges.forEach(edge => {
        if (edge.source === camperCmId) {
          affectedNodeIds.add(edge.target);
        } else if (edge.target === camperCmId) {
          affectedNodeIds.add(edge.source);
        }
      });
      
      // Add nodes from the old and new bunks
      graph.nodes.forEach(node => {
        if (node.bunk_cm_id === oldBunkCmId || node.bunk_cm_id === toBunkCmId) {
          affectedNodeIds.add(node.id);
        }
      });
      
      // Recalculate metrics for affected nodes
      affectedNodeIds.forEach(nodeId => {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node) {
          // Calculate degree centrality (normalized by graph size - 1)
          const degree = graph.edges.filter(e => 
            e.source === nodeId || e.target === nodeId
          ).length;
          node.centrality = graph.nodes.length > 1 ? degree / (graph.nodes.length - 1) : 0;
          
          // Simple clustering coefficient approximation
          const neighbors = new Set<number>();
          graph.edges.forEach(edge => {
            if (edge.source === nodeId) neighbors.add(edge.target);
            if (edge.target === nodeId) neighbors.add(edge.source);
          });
          
          if (neighbors.size >= 2) {
            let triangles = 0;
            const neighborArray = Array.from(neighbors);
            for (let i = 0; i < neighborArray.length; i++) {
              for (let j = i + 1; j < neighborArray.length; j++) {
                const hasEdge = graph.edges.some(edge => 
                  (edge.source === neighborArray[i] && edge.target === neighborArray[j]) ||
                  (edge.source === neighborArray[j] && edge.target === neighborArray[i])
                );
                if (hasEdge) triangles++;
              }
            }
            const possibleTriangles = neighbors.size * (neighbors.size - 1) / 2;
            node.clustering = possibleTriangles > 0 ? triangles / possibleTriangles : 0;
          } else {
            node.clustering = 0;
          }
        }
      });
      
      // Update global metrics
      if (graph.metrics) {
        // Recalculate average clustering
        const totalClustering = graph.nodes.reduce((sum, node) => sum + node.clustering, 0);
        graph.metrics.average_clustering = graph.nodes.length > 0 ? totalClustering / graph.nodes.length : 0;
        
        // Recalculate average degree
        const totalDegree = graph.edges.length * 2; // Each edge contributes to 2 degrees
        graph.metrics.average_degree = graph.nodes.length > 0 ? totalDegree / graph.nodes.length : 0;
      }
      
      // Update cache timestamp to prevent immediate expiration
      entry.timestamp = Date.now();
      
      // Invalidate affected bunk graphs
      if (fromBunkCmId) {
        this.invalidateBunk(fromBunkCmId, sessionCmId);
      }
      if (toBunkCmId) {
        this.invalidateBunk(toBunkCmId, sessionCmId);
      }
      
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Updated graph for camper move: ${camperCmId} from bunk ${fromBunkCmId} to ${toBunkCmId}`);
        console.log(`[GraphCache] Updated metrics for ${affectedNodeIds.size} affected nodes`);
      }
    } catch (error) {
      // If update fails, invalidate to force refresh
      console.error('[GraphCache] Failed to update graph:', error);
      this.invalidate(sessionCmId);
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  // Private helper methods

  private async getOrFetch(
    key: GraphCacheKey,
    fetcher: () => Promise<GraphData>
  ): Promise<GraphData> {
    this.metrics.totalRequests++;
    
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached)) {
      this.metrics.hits++;
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Cache hit for ${key}`);
      }
      return cached.data;
    }
    
    this.metrics.misses++;
    if (import.meta.env.DEV) {
      console.log(`[GraphCache] Cache miss for ${key}, fetching...`);
    }
    
    try {
      const data = await fetcher();
      this.store(key, data);
      return data;
    } catch (error) {
      console.error(`[GraphCache] Failed to fetch data for ${key}:`, error);
      throw error;
    }
  }

  private store(key: GraphCacheKey, data: GraphData): void {
    const size = this.estimateSize(data);
    
    // Check if we need to evict entries to make room
    while (this.metrics.totalSize + size > this.maxCacheSize && this.cache.size > 0) {
      this.evictOldest();
    }
    
    const entry: CacheEntry<GraphData> = {
      data,
      timestamp: Date.now(),
      size,
    };
    
    this.cache.set(key, entry);
    this.metrics.totalSize += size;
    this.metrics.entryCount = this.cache.size;
  }

  private removeEntry(key: GraphCacheKey): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.metrics.totalSize -= entry.size;
      this.metrics.entryCount = this.cache.size;
    }
  }

  private isExpired(entry: CacheEntry<GraphData>): boolean {
    return Date.now() - entry.timestamp > this.cacheExpiration;
  }

  private cleanupStaleEntries(): void {
    let removedCount = 0;
    let freedSize = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        freedSize += entry.size;
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      this.metrics.totalSize -= freedSize;
      this.metrics.entryCount = this.cache.size;
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Cleaned up ${removedCount} expired entries, freed ${this.formatSize(freedSize)}`);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: GraphCacheKey | null = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.removeEntry(oldestKey);
      if (import.meta.env.DEV) {
        console.log(`[GraphCache] Evicted ${oldestKey} to make room`);
      }
    }
  }

  private estimateSize(data: GraphData): number {
    // Rough estimation of object size in memory
    let size = 0;
    
    // Nodes
    size += data.nodes.length * 200; // Estimate ~200 bytes per node
    
    // Edges
    size += data.edges.length * 100; // Estimate ~100 bytes per edge
    
    // Metrics
    size += Object.keys(data.metrics || {}).length * 50;
    
    // Communities
    const communityEntries = Object.entries(data.communities || {});
    size += communityEntries.reduce((acc, [_, members]) => acc + members.length * 8, 0);
    
    return size;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  private logMetrics(): void {
    if (import.meta.env.DEV) {
      const hitRate = this.metrics.totalRequests > 0 
        ? (this.metrics.hits / this.metrics.totalRequests * 100).toFixed(1)
        : '0.0';
      
      console.log(
        `[GraphCache] Metrics - Hit Rate: ${hitRate}%, ` +
        `Entries: ${this.metrics.entryCount}, ` +
        `Size: ${this.formatSize(this.metrics.totalSize)}, ` +
        `Requests: ${this.metrics.totalRequests} (${this.metrics.hits} hits, ${this.metrics.misses} misses)`
      );
    }
  }
}

// Export singleton instance
export const graphCacheService = new GraphCacheService();