import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphCacheService } from './GraphCacheService'
import type { GraphData } from '../types/graph'

/**
 * Build a minimal GraphData shape that the cache can store / size-estimate.
 */
let nextId = 1
function makeGraph(tag: string): GraphData {
  return {
    nodes: [
      {
        id: nextId++,
        name: `${tag}-node`,
        grade: null,
        bunk_cm_id: null,
        centrality: 0,
        clustering: 0,
        community: null,
      },
    ],
    edges: [],
    metrics: {
      density: 0,
      average_clustering: 0,
      number_of_components: 0,
      average_degree: 0,
    },
    communities: {},
    warnings: [],
    layout_positions: {},
  }
}

describe('GraphCacheService (scenario-aware)', () => {
  let service: GraphCacheService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new GraphCacheService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves a prod graph under the prod key', async () => {
    const prod = makeGraph('prod')
    const fetcher = vi.fn().mockResolvedValue(prod)

    const first = await service.getSessionGraph(42, fetcher, 2026)
    const second = await service.getSessionGraph(42, fetcher, 2026)

    expect(first).toBe(prod)
    expect(second).toBe(prod)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does NOT collide prod and scenario graphs for the same session+year', async () => {
    const prod = makeGraph('prod')
    const scenarioA = makeGraph('scnA')

    const prodFetcher = vi.fn().mockResolvedValue(prod)
    const scenarioFetcher = vi.fn().mockResolvedValue(scenarioA)

    // Cache the prod graph first
    const prodResult = await service.getSessionGraph(42, prodFetcher, 2026)
    expect(prodResult).toBe(prod)

    // A scenario lookup for the same session+year must NOT hit the prod cache —
    // it must call the scenario fetcher and return the scenario graph.
    const scnResult = await service.getSessionGraph(42, scenarioFetcher, 2026, 'scn_abc')
    expect(scnResult).toBe(scenarioA)
    expect(scenarioFetcher).toHaveBeenCalledTimes(1)

    // And a subsequent prod lookup must still return the prod graph (not the
    // scenario one overwriting it).
    const prodAgain = await service.getSessionGraph(42, prodFetcher, 2026)
    expect(prodAgain).toBe(prod)
    expect(prodFetcher).toHaveBeenCalledTimes(1) // still just the initial call
  })

  it('treats two different scenarios as distinct caches', async () => {
    const scenarioA = makeGraph('scnA')
    const scenarioB = makeGraph('scnB')

    const fetcherA = vi.fn().mockResolvedValue(scenarioA)
    const fetcherB = vi.fn().mockResolvedValue(scenarioB)

    const a = await service.getSessionGraph(7, fetcherA, 2026, 'scn_a')
    const b = await service.getSessionGraph(7, fetcherB, 2026, 'scn_b')

    expect(a).toBe(scenarioA)
    expect(b).toBe(scenarioB)
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)

    // Each scenario lookup should hit its own cache on repeat.
    const aAgain = await service.getSessionGraph(7, fetcherA, 2026, 'scn_a')
    const bAgain = await service.getSessionGraph(7, fetcherB, 2026, 'scn_b')

    expect(aAgain).toBe(scenarioA)
    expect(bAgain).toBe(scenarioB)
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
  })

  it('invalidate(sessionCmId) wipes both prod and scenario caches for that session', async () => {
    const prod = makeGraph('prod')
    const scenario = makeGraph('scn')

    await service.getSessionGraph(99, vi.fn().mockResolvedValue(prod), 2026)
    await service.getSessionGraph(99, vi.fn().mockResolvedValue(scenario), 2026, 'scn_x')

    service.invalidate(99)

    // After invalidation, both lookups must miss and call their fetchers.
    const newProd = makeGraph('prod2')
    const newScenario = makeGraph('scn2')

    const prodFetcher = vi.fn().mockResolvedValue(newProd)
    const scenarioFetcher = vi.fn().mockResolvedValue(newScenario)

    const prodResult = await service.getSessionGraph(99, prodFetcher, 2026)
    const scnResult = await service.getSessionGraph(99, scenarioFetcher, 2026, 'scn_x')

    expect(prodResult).toBe(newProd)
    expect(scnResult).toBe(newScenario)
    expect(prodFetcher).toHaveBeenCalledTimes(1)
    expect(scenarioFetcher).toHaveBeenCalledTimes(1)
  })

  it('passing null/undefined scenarioId behaves the same as omitting it (prod path)', async () => {
    const prod = makeGraph('prod')
    const fetcher = vi.fn().mockResolvedValue(prod)

    await service.getSessionGraph(5, fetcher, 2026)
    await service.getSessionGraph(5, fetcher, 2026, null)
    await service.getSessionGraph(5, fetcher, 2026, undefined)

    // All three calls should hit the same prod cache key — only one fetch.
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('GraphCacheService bunk graph (scenario-aware)', () => {
  let service: GraphCacheService

  beforeEach(() => {
    vi.useFakeTimers()
    service = new GraphCacheService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores and retrieves a prod bunk graph under the prod key', async () => {
    const prod = makeGraph('bunk-prod')
    const fetcher = vi.fn().mockResolvedValue(prod)

    const first = await service.getBunkGraph(101, 42, fetcher, 2026)
    const second = await service.getBunkGraph(101, 42, fetcher, 2026)

    expect(first).toBe(prod)
    expect(second).toBe(prod)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does NOT collide prod and scenario bunk graphs for the same bunk+session+year', async () => {
    const prod = makeGraph('bunk-prod')
    const scenarioA = makeGraph('bunk-scnA')

    const prodFetcher = vi.fn().mockResolvedValue(prod)
    const scenarioFetcher = vi.fn().mockResolvedValue(scenarioA)

    const prodResult = await service.getBunkGraph(101, 42, prodFetcher, 2026)
    expect(prodResult).toBe(prod)

    const scnResult = await service.getBunkGraph(101, 42, scenarioFetcher, 2026, 'scn_abc')
    expect(scnResult).toBe(scenarioA)
    expect(scenarioFetcher).toHaveBeenCalledTimes(1)

    // prod still intact
    const prodAgain = await service.getBunkGraph(101, 42, prodFetcher, 2026)
    expect(prodAgain).toBe(prod)
    expect(prodFetcher).toHaveBeenCalledTimes(1)
  })

  it('treats two different bunk scenarios as distinct caches', async () => {
    const scenarioA = makeGraph('bunk-scnA')
    const scenarioB = makeGraph('bunk-scnB')

    const fetcherA = vi.fn().mockResolvedValue(scenarioA)
    const fetcherB = vi.fn().mockResolvedValue(scenarioB)

    const a = await service.getBunkGraph(101, 42, fetcherA, 2026, 'scn_a')
    const b = await service.getBunkGraph(101, 42, fetcherB, 2026, 'scn_b')

    expect(a).toBe(scenarioA)
    expect(b).toBe(scenarioB)
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)

    const aAgain = await service.getBunkGraph(101, 42, fetcherA, 2026, 'scn_a')
    const bAgain = await service.getBunkGraph(101, 42, fetcherB, 2026, 'scn_b')

    expect(aAgain).toBe(scenarioA)
    expect(bAgain).toBe(scenarioB)
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
  })

  it('passing null/undefined scenarioId behaves the same as omitting it (prod path) for bunks', async () => {
    const prod = makeGraph('bunk-prod')
    const fetcher = vi.fn().mockResolvedValue(prod)

    await service.getBunkGraph(9, 42, fetcher, 2026)
    await service.getBunkGraph(9, 42, fetcher, 2026, null)
    await service.getBunkGraph(9, 42, fetcher, 2026, undefined)

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('invalidate(sessionCmId) wipes prod and scenario bunk caches for that session', async () => {
    const prod = makeGraph('bunk-prod')
    const scenario = makeGraph('bunk-scn')

    await service.getBunkGraph(101, 42, vi.fn().mockResolvedValue(prod), 2026)
    await service.getBunkGraph(101, 42, vi.fn().mockResolvedValue(scenario), 2026, 'scn_x')

    service.invalidate(42)

    const newProd = makeGraph('bunk-prod2')
    const newScenario = makeGraph('bunk-scn2')

    const prodFetcher = vi.fn().mockResolvedValue(newProd)
    const scenarioFetcher = vi.fn().mockResolvedValue(newScenario)

    const prodResult = await service.getBunkGraph(101, 42, prodFetcher, 2026)
    const scnResult = await service.getBunkGraph(101, 42, scenarioFetcher, 2026, 'scn_x')

    expect(prodResult).toBe(newProd)
    expect(scnResult).toBe(newScenario)
    expect(prodFetcher).toHaveBeenCalledTimes(1)
    expect(scenarioFetcher).toHaveBeenCalledTimes(1)
  })
})
