import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { queryClient, invalidateSyncData } from './queryClient'

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))

describe('invalidateSyncData', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('invalidates all sync-dependent query key prefixes', () => {
    invalidateSyncData()

    const invalidatedPrefixes = spy.mock.calls.map(
      (call: unknown[]) => (call[0] as { queryKey: string[] }).queryKey[0]
    )

    // Every prefix that depends on synced CampMinder data must be invalidated.
    // Note: velocity, forecast, day1 use ['metrics', ...] prefix in queryKeys.ts,
    // so 'metrics' covers them. 'bunk-staff' is its own separate prefix.
    const requiredPrefixes = [
      'sessions',
      'all-sessions',
      'session',
      'session-stats',
      'session-groups',
      'session-programs',
      'campers',
      'all-campers',
      'camper',
      'camper-history',
      'enrolled-campers',
      'bunks',
      'bunk-assignments',
      'bunk-requests',
      'bunk-request-status',
      'historical-bunking',
      'bunk-staff',
      'metrics',
      'sync-status',
    ]

    for (const prefix of requiredPrefixes) {
      expect(invalidatedPrefixes, `Missing invalidation for '${prefix}'`).toContain(prefix)
    }
  })

  it('fires server-side cache invalidation', () => {
    invalidateSyncData()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/metrics/cache/invalidate', {
      method: 'POST',
    })
  })
})
