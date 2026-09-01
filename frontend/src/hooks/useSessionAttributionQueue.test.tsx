/**
 * The cabin-weekend attribution queue's shared data hook (kindred#2648 UI
 * half) — one fetch of `lodging_ingest_issues` (kind=ambiguous_session),
 * enriched with alias-resolved unit names and labeled candidate weekends, and
 * the one-time confirm mutation. Both the admin tab and the board's modal
 * read this hook rather than each wiring the three underlying queries
 * themselves.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentYearContext, type CurrentYearContextType } from './useCurrentYear'

const listAmbiguousSessionIssues = vi.fn()
const listLodgingAliases = vi.fn()
const confirmSessionAttribution = vi.fn()
const fetchWeekendSessions = vi.fn()
const fetchSessionAttributionConflicts = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../services/lodgingCrud', () => ({
  listAmbiguousSessionIssues: (...args: unknown[]) => listAmbiguousSessionIssues(...args),
  listLodgingAliases: (...args: unknown[]) => listLodgingAliases(...args),
  confirmSessionAttribution: (...args: unknown[]) => confirmSessionAttribution(...args),
}))

vi.mock('../services/lodgingApi', () => ({
  fetchWeekendSessions: (...args: unknown[]) => fetchWeekendSessions(...args),
  fetchSessionAttributionConflicts: (...args: unknown[]) =>
    fetchSessionAttributionConflicts(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import { useSessionAttributionQueue } from './useSessionAttributionQueue'

const ROW_A = {
  id: 'q1',
  kind: 'ambiguous_session' as const,
  raw_value: 'Ridge I',
  source_field: 'Family Camp Cabin',
  year: 2026,
  household_cm_id: 2000001,
  person_cm_id: 0,
  suggested_session: 'sess_a',
  candidate_session_cm_ids: [1309515, 1309519],
  confirmed_session_cm_id: 0,
  occurrences: 3,
  resolved_alias: '',
  first_seen: '2026-08-18 00:00:00.000Z',
  last_seen: '2026-08-23 00:00:00.000Z',
  is_resolved: false,
  resolution_note: '',
}

// A stale sibling: same shape, older last_seen than ROW_A, no alias.
const ROW_STALE = {
  ...ROW_A,
  id: 'q9',
  raw_value: 'Tuolumne 2',
  candidate_session_cm_ids: [1309514, 1309515],
  last_seen: '2026-05-15 00:00:00.000Z',
}

const SESSIONS = [
  {
    session_id: 'sess_a',
    session_cm_id: 1309515,
    name: 'Family Camp 2: Keshet Weekend',
    session_type: 'family',
    start_date: '2026-08-20',
    end_date: '2026-08-23',
  },
  {
    session_id: 'sess_b',
    session_cm_id: 1309519,
    name: 'Family Camp 6',
    session_type: 'family',
    start_date: '2026-09-24',
    end_date: '2026-09-27',
  },
]

const ALIASES = [
  {
    id: 'alias_1',
    alias_string: 'Ridge I',
    member_units: ['u1'],
    expand: { member_units: [{ id: 'u1', name: 'Ridge I' }] },
  },
]

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  listAmbiguousSessionIssues.mockResolvedValue([ROW_A])
  listLodgingAliases.mockResolvedValue(ALIASES)
  fetchWeekendSessions.mockResolvedValue({ year: 2026, sessions: SESSIONS })
  // No evidence by default — every pre-§12.8 expectation in this file is the
  // DEGRADED render, which is the state the queue must keep working in.
  fetchSessionAttributionConflicts.mockResolvedValue({ year: 2026, rows: [] })
  confirmSessionAttribution.mockResolvedValue({ id: 'q1', confirmed_session_cm_id: 1309515 })
})

const YEAR_CONTEXT: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026],
  isTransitioning: false,
  isYearReady: true,
}

function wrapper(context: CurrentYearContextType) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <CurrentYearContext.Provider value={context}>{children}</CurrentYearContext.Provider>
      </QueryClientProvider>
    )
  }
}

describe('useSessionAttributionQueue', () => {
  it('does not fetch until the year resolves', () => {
    renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
    })
    expect(listAmbiguousSessionIssues).not.toHaveBeenCalled()
  })

  it('fetches ambiguous-session queue rows for the current year', async () => {
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(listAmbiguousSessionIssues).toHaveBeenCalledWith(2026)
  })

  it('resolves each row to real unit names through the alias table', async () => {
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    const row = result.current.items.find((i) => i.id === 'q1')
    expect(row?.resolvedUnitNames).toEqual(['Ridge I'])
  })

  it('labels every candidate weekend and flags the suggested one', async () => {
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    const row = result.current.items.find((i) => i.id === 'q1')
    expect(row?.candidates).toEqual([
      expect.objectContaining({ sessionCmId: 1309515, short: 'Family Camp 2', isSuggested: true }),
      expect.objectContaining({ sessionCmId: 1309519, short: 'Family Camp 6', isSuggested: false }),
    ])
  })

  it('falls back to a numeric label for a candidate not in the fetched session list', async () => {
    listAmbiguousSessionIssues.mockResolvedValue([
      { ...ROW_A, candidate_session_cm_ids: [1309515, 9999999], suggested_session: '' },
    ])
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    const row = result.current.items[0]
    expect(row?.candidates.find((c) => c.sessionCmId === 9999999)?.short).toBe('#9999999')
  })

  it('flags a row strictly older than the batch freshest last_seen as stale', async () => {
    listAmbiguousSessionIssues.mockResolvedValue([ROW_A, ROW_STALE])
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.items.find((i) => i.id === 'q1')?.isStale).toBe(false)
    expect(result.current.items.find((i) => i.id === 'q9')?.isStale).toBe(true)
  })

  // The module doc is explicit: "Only the primary queue query gates
  // isLoading/error for QueryGuard purposes; a failed alias or session fetch
  // degrades the RENDER ... rather than blocking it." QueryGuard checks
  // isLoading before data, so if isLoading stays true while the queue's own
  // rows are already in hand, staff see a perpetual spinner instead of the
  // degraded-but-usable row the doc promises.
  it('stops loading once the queue resolves, even while alias/session enrichment is still pending', async () => {
    listLodgingAliases.mockReturnValue(new Promise(() => undefined))
    fetchWeekendSessions.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.data).toBeDefined()
  })

  it('degrades gracefully when the alias fetch fails, rather than blocking the queue', async () => {
    listLodgingAliases.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useSessionAttributionQueue(), {
      wrapper: wrapper(YEAR_CONTEXT),
    })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.items[0]?.resolvedUnitNames).toEqual([])
  })

  describe('confirm', () => {
    it('writes confirmed_session_cm_id for the chosen candidate and reports success', async () => {
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
      const row = result.current.items[0]
      if (!row) throw new Error('expected a row')

      result.current.confirm(row, 1309515)

      await waitFor(() => {
        expect(confirmSessionAttribution).toHaveBeenCalledWith('q1', 1309515)
      })
      await waitFor(() => {
        expect(toastSuccess).toHaveBeenCalledTimes(1)
      })
    })

    it('re-fetches the queue after a successful confirm, so the row drops off', async () => {
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
      listAmbiguousSessionIssues.mockResolvedValue([])

      const row = result.current.items[0]
      if (!row) throw new Error('expected a row')
      result.current.confirm(row, 1309515)

      await waitFor(() => {
        expect(listAmbiguousSessionIssues).toHaveBeenCalledTimes(2)
      })
    })

    it('reports a failure without throwing', async () => {
      confirmSessionAttribution.mockRejectedValue(new Error('candidate mismatch'))
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
      const row = result.current.items[0]
      if (!row) throw new Error('expected a row')

      result.current.confirm(row, 1309515)

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith('candidate mismatch')
      })
    })
  })

  /**
   * Occupancy evidence (§12.8, owner-ruled 2026-08-31 — closes no issue and
   * none is filed). The verdicts arrive computed from
   * `GET /api/lodging/attribution/conflicts`; what is pinned here is how the
   * queue row USES them.
   */
  describe('occupancy evidence', () => {
    // ROW_A's candidates are FC2 (1309515, the stored `suggested_session`)
    // and FC6 (1309519). Here FC2 is taken, so the guess must move to FC6.
    const DEMOTING_EVIDENCE = {
      year: 2026,
      rows: [
        {
          issue_id: 'q1',
          candidates: [
            {
              session_cm_id: 1309515,
              verdict: 'conflict',
              occupants: [
                {
                  kind: 'placement',
                  label: 'The Garcia Family',
                  leaf_name: 'Ridge I',
                  container_name: '',
                },
              ],
            },
            { session_cm_id: 1309519, verdict: 'free', occupants: [] },
          ],
          conflict_in_every_candidate: false,
          timestamp_suggested_session_cm_id: 1309515,
          conflict_aware_suggested_session_cm_id: 1309519,
          demotion_applied: true,
        },
      ],
    }

    it('moves the best guess to the conflict-aware pick — occupancy outranks the timestamp', async () => {
      fetchSessionAttributionConflicts.mockResolvedValue(DEMOTING_EVIDENCE)
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.items[0]?.demotion).toBeDefined()
      })
      const row = result.current.items[0]
      // The STORED suggestion is FC2 and it loses; without the evidence the
      // test above ("labels every candidate weekend") has FC2 suggested.
      expect(row?.candidates.find((c) => c.sessionCmId === 1309515)?.isSuggested).toBe(false)
      expect(row?.candidates.find((c) => c.sessionCmId === 1309519)?.isSuggested).toBe(true)
    })

    it('names BOTH weekends in the demotion, so the row can explain itself', async () => {
      fetchSessionAttributionConflicts.mockResolvedValue(DEMOTING_EVIDENCE)
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.items[0]?.demotion).toBeDefined()
      })
      expect(result.current.items[0]?.demotion).toEqual({
        fromShort: 'Family Camp 2',
        toShort: 'Family Camp 6',
      })
    })

    it('attaches each candidate’s verdict and occupants', async () => {
      fetchSessionAttributionConflicts.mockResolvedValue(DEMOTING_EVIDENCE)
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.items[0]?.candidates[0]?.verdict).toBeDefined()
      })
      const row = result.current.items[0]
      expect(row?.candidates.find((c) => c.sessionCmId === 1309515)?.verdict).toBe('conflict')
      expect(row?.candidates.find((c) => c.sessionCmId === 1309515)?.occupants).toEqual([
        {
          kind: 'placement',
          label: 'The Garcia Family',
          leafName: 'Ridge I',
          containerName: '',
        },
      ])
      expect(row?.candidates.find((c) => c.sessionCmId === 1309519)?.verdict).toBe('free')
    })

    it('marks NO best guess when every candidate conflicts, and demotes nothing', async () => {
      fetchSessionAttributionConflicts.mockResolvedValue({
        year: 2026,
        rows: [
          {
            issue_id: 'q1',
            candidates: [
              { session_cm_id: 1309515, verdict: 'conflict', occupants: [] },
              { session_cm_id: 1309519, verdict: 'conflict', occupants: [] },
            ],
            conflict_in_every_candidate: true,
            // The rule leaves the stored pick alone in this case — it demotes
            // nothing — so the two suggestions AGREE and no banner is due.
            timestamp_suggested_session_cm_id: 1309515,
            conflict_aware_suggested_session_cm_id: 1309515,
            demotion_applied: false,
          },
        ],
      })
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.items[0]?.conflictInEveryCandidate).toBe(true)
      })
      const row = result.current.items[0]
      expect(row?.candidates.every((c) => !c.isSuggested)).toBe(true)
      expect(row?.demotion).toBeUndefined()
    })

    it('keeps the timestamp best guess when the evidence fetch fails — degrades, never blocks', async () => {
      // The whole point of not gating `isLoading`/`error` on this query: the
      // queue still tells staff which cabins are waiting.
      fetchSessionAttributionConflicts.mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useSessionAttributionQueue(), {
        wrapper: wrapper(YEAR_CONTEXT),
      })
      await waitFor(() => {
        expect(result.current.data).toBeDefined()
      })
      expect(result.current.error).toBeNull()
      const row = result.current.items[0]
      expect(row?.candidates.find((c) => c.sessionCmId === 1309515)?.isSuggested).toBe(true)
      expect(row?.candidates[0]?.verdict).toBeUndefined()
      expect(row?.conflictInEveryCandidate).toBeUndefined()
    })
  })
})
