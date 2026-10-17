/**
 * Tests for useSyncCompletionToasts hook - sub_stats formatting
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import toast from 'react-hot-toast'
import {
  formatStatsText,
  useSyncCompletionToasts,
  SYNC_DISPLAY_NAMES,
} from './useSyncCompletionToasts'
import type { SyncStatusResponse } from './useSyncStatusAPI'
import { getBackendSyncJobIds } from '../test/backendSyncJobIds'
import { invalidateSyncData } from '../utils/queryClient'

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
// The options every useSyncStatusAPI call was given, so a test can see which season was asked for.
let statusCalls: Array<{ year?: number } | undefined> = []
// useSyncStatusAPI keeps the previous season's payload as placeholder data while a new season loads.
let mockIsPlaceholderData = false
vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts?: { year?: number }) => {
    statusCalls.push(opts)
    return { data: mockSyncStatus, isPlaceholderData: mockIsPlaceholderData }
  },
}))

// kindred#2803: spied so a test can see WHICH sync the completion names. Every other
// export of the module stays real.
vi.mock('../utils/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/queryClient')>()),
  invalidateSyncData: vi.fn(),
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

// kindred#2593: the completion loop iterates Object.keys(SYNC_DISPLAY_NAMES), not the
// payload -- a job absent from this map gets no completion toast AND no invalidateSyncData()
// call on completion. Anchored to the backend's own statusSyncTypes() (pocketbase/sync/api.go)
// rather than to the other frontend lists, which would drift in lockstep and prove nothing.
describe('SYNC_DISPLAY_NAMES backend coverage (kindred#2593)', () => {
  it('has a display name for every job the backend publishes on the sync-status payload', () => {
    const backendIds = getBackendSyncJobIds().slice().sort()
    const displayNameIds = Object.keys(SYNC_DISPLAY_NAMES).sort()
    expect(displayNameIds).toEqual(backendIds)
  })
})

// kindred#2803: the server clears its weekend cache only for a sync that writes a table the
// cache holds, which it can decide only if the completion says which sync it was.
describe('useSyncCompletionToasts names the completed sync when it invalidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus = null
  })

  it.each(['bunk_assignments', 'attendees'])('passes %s to invalidateSyncData', (syncType) => {
    mockSyncStatus = { [syncType]: { status: 'running' } }
    const { rerender } = renderHook(() => useSyncCompletionToasts())

    mockSyncStatus = {
      [syncType]: { status: 'success', summary: { created: 0, updated: 1, skipped: 0, errors: 0 } },
    }
    rerender()

    expect(invalidateSyncData).toHaveBeenCalledTimes(1)
    expect(invalidateSyncData).toHaveBeenCalledWith(syncType)
  })

  it('names the sync on a failed completion too', () => {
    mockSyncStatus = { persons: { status: 'running' } } as unknown as SyncStatusResponse
    const { rerender } = renderHook(() => useSyncCompletionToasts())

    mockSyncStatus = {
      persons: { status: 'failed', error: 'boom' },
    } as unknown as SyncStatusResponse
    rerender()

    expect(invalidateSyncData).toHaveBeenCalledWith('persons')
  })
})

// Scan fix (#3211): Manage > Sync's status is the viewed season's when that is a synced season,
// so each season's cards show their own last runs. Any other year reads the payload as before.
describe('useSyncCompletionToasts asks for the viewed season', () => {
  beforeEach(() => {
    statusCalls = []
    mockSyncStatus = { _configured_year: 2027, _synced_years: [2027, 2026] }
  })

  it.each([2027, 2026])('asks for synced season %i', (viewed) => {
    renderHook(() => useSyncCompletionToasts(viewed))
    expect(statusCalls.some((opts) => opts?.year === viewed)).toBe(true)
  })

  it('asks for no season when the viewed year is not synced', () => {
    renderHook(() => useSyncCompletionToasts(2019))
    expect(statusCalls.every((opts) => opts?.year === undefined)).toBe(true)
  })

  it('asks for no season when no year is given', () => {
    renderHook(() => useSyncCompletionToasts())
    expect(statusCalls.every((opts) => opts?.year === undefined)).toBe(true)
  })
})

// CodeRabbit on #3211: useSyncStatusAPI keeps the previous season's payload as placeholder data
// while the newly viewed season loads. Those statuses are not the new season's, so they must not
// become its baseline -- else a job running in the old season and finished in the new one reads
// as a completion that never happened.
describe('useSyncCompletionToasts ignores the old season while the new one loads', () => {
  const seasons = { _configured_year: 2027, _synced_years: [2027, 2026] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPlaceholderData = false
  })

  it('fires no completion when the old season showed a job running and the new one shows it done', () => {
    mockSyncStatus = {
      ...seasons,
      attendees: { status: 'running' },
    } as unknown as SyncStatusResponse
    const { rerender } = renderHook(({ viewed }) => useSyncCompletionToasts(viewed), {
      initialProps: { viewed: 2027 },
    })

    // Switch to 2026: the first render still carries 2027's payload, as placeholder data.
    mockIsPlaceholderData = true
    rerender({ viewed: 2026 })

    // 2026's own payload arrives: its attendees run long finished.
    mockIsPlaceholderData = false
    mockSyncStatus = {
      ...seasons,
      attendees: { status: 'success', summary: { created: 0, updated: 1, skipped: 0, errors: 0 } },
    } as unknown as SyncStatusResponse
    rerender({ viewed: 2026 })

    expect(invalidateSyncData).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('still fires a real completion in the new season once its own payload is in', () => {
    mockSyncStatus = {
      ...seasons,
      attendees: { status: 'success' },
    } as unknown as SyncStatusResponse
    const { rerender } = renderHook(({ viewed }) => useSyncCompletionToasts(viewed), {
      initialProps: { viewed: 2027 },
    })

    mockIsPlaceholderData = true
    rerender({ viewed: 2026 })

    mockIsPlaceholderData = false
    mockSyncStatus = {
      ...seasons,
      attendees: { status: 'running' },
    } as unknown as SyncStatusResponse
    rerender({ viewed: 2026 })

    mockSyncStatus = {
      ...seasons,
      attendees: { status: 'success', summary: { created: 0, updated: 1, skipped: 0, errors: 0 } },
    } as unknown as SyncStatusResponse
    rerender({ viewed: 2026 })

    expect(invalidateSyncData).toHaveBeenCalledTimes(1)
    expect(invalidateSyncData).toHaveBeenCalledWith('attendees')
  })
})

// Coordinator ruling on #3281: the hourly schedule now runs sessions, attendees, persons and
// bunk_assignments, so a completion toast per job would pop on Manage > Sync every hour. A run
// the hourly schedule started (`trigger: 'hourly'`, Status.Trigger) toasts nothing. Its card still
// updates, so the completion still invalidates. Staff-started and nightly runs toast as before.
describe('useSyncCompletionToasts stays quiet for hourly runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStatus = null
    mockIsPlaceholderData = false
  })

  function finish(syncType: string, end: Record<string, unknown>) {
    mockSyncStatus = {
      [syncType]: { status: 'running', trigger: end['trigger'] },
    } as unknown as SyncStatusResponse
    const { rerender } = renderHook(() => useSyncCompletionToasts())
    mockSyncStatus = { [syncType]: end } as unknown as SyncStatusResponse
    rerender()
  }

  it.each(['sessions', 'attendees', 'persons', 'bunk_assignments'])(
    'pops no toast when the hourly run of %s succeeds, and still invalidates',
    (syncType) => {
      finish(syncType, {
        status: 'success',
        trigger: 'hourly',
        summary: { created: 0, updated: 3, skipped: 0, errors: 0 },
      })

      expect(toast.success).not.toHaveBeenCalled()
      expect(toast).not.toHaveBeenCalled()
      expect(invalidateSyncData).toHaveBeenCalledWith(syncType)
    }
  )

  it('pops no toast when an hourly run fails, and still invalidates', () => {
    finish('attendees', { status: 'failed', trigger: 'hourly', error: 'boom' })

    expect(toast).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(invalidateSyncData).toHaveBeenCalledWith('attendees')
  })

  it('pops no toast for an hourly run that completed with issues', () => {
    finish('persons', {
      status: 'success',
      trigger: 'hourly',
      summary: { created: 0, updated: 1, skipped: 0, errors: 2 },
    })

    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['daily', 'manual'])('still toasts a %s run', (trigger) => {
    finish('attendees', {
      status: 'success',
      trigger,
      summary: { created: 0, updated: 3, skipped: 0, errors: 0 },
    })

    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('still toasts a run with no trigger on the payload', () => {
    finish('attendees', {
      status: 'success',
      summary: { created: 0, updated: 3, skipped: 0, errors: 0 },
    })

    expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
