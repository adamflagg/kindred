import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useViewedSeasonSyncStatus } from './useViewedSeasonSyncStatus'

const mockUseSyncStatusAPI = vi.fn()
vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts?: unknown) => mockUseSyncStatusAPI(opts),
}))

const unscoped = { _configured_year: 2027, _synced_years: [2027, 2026] }

describe('useViewedSeasonSyncStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports loading while the scoped query shows the previous year as placeholder data', () => {
    const previousYears = { _configured_year: 2027, _synced_years: [2027, 2026], marker: 'old' }
    mockUseSyncStatusAPI.mockImplementation((opts?: { year?: number }) =>
      opts?.year === undefined
        ? { data: unscoped, isPlaceholderData: false }
        : { data: previousYears, isPlaceholderData: true }
    )
    const { result } = renderHook(() => useViewedSeasonSyncStatus(2026))
    expect(result.current).toEqual({ kind: 'loading' })
  })

  it('reports synced once the requested year has arrived', () => {
    const scoped = { ...unscoped, marker: 'new' }
    const refetch = vi.fn()
    mockUseSyncStatusAPI.mockImplementation((opts?: { year?: number }) =>
      opts?.year === undefined
        ? { data: unscoped, isPlaceholderData: false }
        : { data: scoped, isPlaceholderData: false, refetch }
    )
    const { result } = renderHook(() => useViewedSeasonSyncStatus(2026))
    expect(result.current).toEqual({ kind: 'synced', scoped, refetch: expect.any(Function) })
  })

  it('hands back a refetch of the viewed season only', () => {
    const refetch = vi.fn()
    mockUseSyncStatusAPI.mockImplementation((opts?: { year?: number }) =>
      opts?.year === undefined
        ? { data: unscoped, isPlaceholderData: false }
        : { data: unscoped, isPlaceholderData: false, refetch }
    )
    const { result } = renderHook(() => useViewedSeasonSyncStatus(2026))
    if (result.current.kind !== 'synced') throw new Error('not synced')
    result.current.refetch()
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
