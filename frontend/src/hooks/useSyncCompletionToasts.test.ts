/**
 * Tests for useSyncCompletionToasts hook - sub_stats formatting
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import toast from 'react-hot-toast'
import { formatStatsText, useSyncCompletionToasts } from './useSyncCompletionToasts'
import type { SyncStatusResponse } from './useSyncStatusAPI'

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))

// useSyncCompletionToasts reads its data straight from useSyncStatusAPI's return value, so
// mocking that hook lets a test drive a running->success transition across two renders
// without standing up a real QueryClient/pb network layer.
let mockSyncStatus: Partial<SyncStatusResponse> | null = null
vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: mockSyncStatus }),
}))

// Helper function to format stats (should match implementation)
interface SubStats {
  created: number
  updated: number
  skipped: number
  errors: number
}

function formatStats(stats: SubStats, label: string): string {
  const parts: string[] = []
  if (stats.created > 0) parts.push(`${stats.created} created`)
  if (stats.updated > 0) parts.push(`${stats.updated} updated`)
  if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
  if (stats.errors > 0) parts.push(`${stats.errors} errors`)
  if (parts.length === 0) return ''
  return `${label}: ${parts.join(', ')}`
}

// Helper to format combined stats message for persons sync
// Note: Tags are now stored as multi-select relation on persons, not as separate sub-stats
function formatPersonsSyncMessage(
  mainStats: SubStats,
  subStats?: Record<string, SubStats>
): string {
  if (!subStats) {
    return formatStats(mainStats, 'Persons')
  }

  const parts: string[] = []

  const personsText = formatStats(mainStats, 'Persons')
  if (personsText) parts.push(personsText)

  const householdsStats = subStats['households']
  if (householdsStats) {
    const householdsText = formatStats(householdsStats, 'Households')
    if (householdsText) parts.push(householdsText)
  }

  return parts.join('\n')
}

describe('formatStats helper', () => {
  it('should format stats with created, updated, and skipped', () => {
    const stats: SubStats = { created: 10, updated: 5, skipped: 2, errors: 0 }
    expect(formatStats(stats, 'Persons')).toBe('Persons: 10 created, 5 updated, 2 skipped')
  })

  it('should format stats with only created and skipped', () => {
    const stats: SubStats = { created: 10, updated: 0, skipped: 2, errors: 0 }
    expect(formatStats(stats, 'Persons')).toBe('Persons: 10 created, 2 skipped')
  })

  it('should format stats with errors', () => {
    const stats: SubStats = { created: 10, updated: 5, skipped: 2, errors: 3 }
    expect(formatStats(stats, 'Persons')).toBe(
      'Persons: 10 created, 5 updated, 2 skipped, 3 errors'
    )
  })

  it('should format stats with only skipped', () => {
    const stats: SubStats = { created: 0, updated: 0, skipped: 100, errors: 0 }
    expect(formatStats(stats, 'Persons')).toBe('Persons: 100 skipped')
  })

  it('should return empty string when all stats are zero', () => {
    const stats: SubStats = { created: 0, updated: 0, skipped: 0, errors: 0 }
    expect(formatStats(stats, 'Persons')).toBe('')
  })
})

describe('formatPersonsSyncMessage', () => {
  it('should format message without sub_stats', () => {
    const mainStats: SubStats = {
      created: 10,
      updated: 5,
      skipped: 85,
      errors: 0,
    }
    expect(formatPersonsSyncMessage(mainStats)).toBe('Persons: 10 created, 5 updated, 85 skipped')
  })

  it('should format message with households sub_stats', () => {
    const mainStats: SubStats = {
      created: 10,
      updated: 5,
      skipped: 85,
      errors: 0,
    }
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
    }

    const result = formatPersonsSyncMessage(mainStats, subStats)
    expect(result).toBe(
      'Persons: 10 created, 5 updated, 85 skipped\nHouseholds: 3 created, 2 updated, 45 skipped'
    )
  })

  it('should show skipped in sub_stats', () => {
    const mainStats: SubStats = {
      created: 10,
      updated: 5,
      skipped: 85,
      errors: 0,
    }
    const subStats: Record<string, SubStats> = {
      households: { created: 0, updated: 0, skipped: 50, errors: 0 },
    }

    const result = formatPersonsSyncMessage(mainStats, subStats)
    expect(result).toBe('Persons: 10 created, 5 updated, 85 skipped\nHouseholds: 50 skipped')
  })

  it('should handle errors in sub_stats', () => {
    const mainStats: SubStats = {
      created: 10,
      updated: 5,
      skipped: 85,
      errors: 0,
    }
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 2 },
    }

    const result = formatPersonsSyncMessage(mainStats, subStats)
    expect(result).toBe(
      'Persons: 10 created, 5 updated, 85 skipped\nHouseholds: 3 created, 2 updated, 45 skipped, 2 errors'
    )
  })

  it('should handle main stats with errors', () => {
    const mainStats: SubStats = {
      created: 10,
      updated: 5,
      skipped: 85,
      errors: 1,
    }
    const subStats: Record<string, SubStats> = {
      households: { created: 3, updated: 2, skipped: 45, errors: 0 },
    }

    const result = formatPersonsSyncMessage(mainStats, subStats)
    expect(result).toBe(
      'Persons: 10 created, 5 updated, 85 skipped, 1 errors\nHouseholds: 3 created, 2 updated, 45 skipped'
    )
  })
})

// kindred#2356: the toast's "N skipped" segment counted discarded custom-field
// VALUES for camper_transportation and staff_applications, not skipped RECORDS
// -- "274 created, 557 skipped" read as 557 skipped applications when it was
// really 557 individual field answers discarded across the 274 rows that WERE
// created. These tests drive the REAL production formatStatsText (exported
// from useSyncCompletionToasts.ts), not a local reimplementation, so a
// regression that re-merges the two counters fails here.
describe('formatStatsText (real production function) - skipped_values segment', () => {
  it('renders skipped_values as its own "N values skipped" segment, distinct from the record-level skipped segment', () => {
    const result = formatStatsText(
      { created: 274, updated: 0, skipped: 0, skipped_values: 557, errors: 0 },
      'Staff Applications'
    )
    expect(result).toBe('Staff Applications: 274 created, 557 values skipped')
  })

  it('keeps both segments when a run has BOTH skipped records and skipped values', () => {
    const result = formatStatsText(
      { created: 10, updated: 0, skipped: 2, skipped_values: 557, errors: 0 },
      'Transportation'
    )
    // Must show two distinct segments -- never collapsed into a combined 559.
    expect(result).toBe('Transportation: 10 created, 2 skipped, 557 values skipped')
    expect(result).not.toContain('559 skipped')
  })

  it('omits the values-skipped segment entirely when skipped_values is zero or absent', () => {
    const result = formatStatsText(
      { created: 5, updated: 0, skipped: 0, errors: 0 },
      'Transportation'
    )
    expect(result).toBe('Transportation: 5 created')
    expect(result).not.toContain('values skipped')
  })
})

// Review follow-up on kindred#2356: the tests above all drive formatStatsText directly, which
// is only half the fix -- the toast itself is produced by useSyncCompletionToasts's "standard
// stats" branch, which builds statsText via `formatStatsText(summary, '')` and hands it to
// toast.success(). A regression that re-hand-copies that field list (reverting back to the
// pre-fix `created/updated/skipped/errors` list, dropping skipped_values) leaves every test
// above green while silently dropping the segment from the actual toast a staff member sees.
// These tests drive the real exported hook end to end -- running->success transition,
// mocked useSyncStatusAPI, real react-hot-toast mock -- so that regression fails here.
describe('useSyncCompletionToasts renders the values-skipped segment in the real toast (kindred#2356)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus = null
  })

  it('includes "N values skipped" in the camper_transportation completion toast, distinct from "N skipped"', () => {
    mockSyncStatus = {
      camper_transportation: { status: 'running' },
    } as unknown as SyncStatusResponse

    const { rerender } = renderHook(() => useSyncCompletionToasts())

    mockSyncStatus = {
      camper_transportation: {
        status: 'success',
        summary: { created: 10, updated: 0, skipped: 2, skipped_values: 557, errors: 0 },
      },
    } as unknown as SyncStatusResponse
    rerender()

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('2 skipped, 557 values skipped'),
      expect.any(Object)
    )
    const [message] = (toast.success as Mock).mock.calls[0] as [string, unknown]
    expect(message).not.toContain('559 skipped')
  })

  it('includes "N values skipped" in the staff_applications completion toast', () => {
    mockSyncStatus = {
      staff_applications: { status: 'running' },
    } as unknown as SyncStatusResponse

    const { rerender } = renderHook(() => useSyncCompletionToasts())

    mockSyncStatus = {
      staff_applications: {
        status: 'success',
        summary: { created: 274, updated: 0, skipped: 0, skipped_values: 557, errors: 0 },
      },
    } as unknown as SyncStatusResponse
    rerender()

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('557 values skipped'),
      expect.any(Object)
    )
  })

  it('omits "values skipped" from the toast when skipped_values is absent', () => {
    mockSyncStatus = {
      camper_transportation: { status: 'running' },
    } as unknown as SyncStatusResponse

    const { rerender } = renderHook(() => useSyncCompletionToasts())

    mockSyncStatus = {
      camper_transportation: {
        status: 'success',
        summary: { created: 10, updated: 0, skipped: 0, errors: 0 },
      },
    } as unknown as SyncStatusResponse
    rerender()

    const [message] = (toast.success as Mock).mock.calls[0] as [string, unknown]
    expect(message).not.toContain('values skipped')
  })
})
