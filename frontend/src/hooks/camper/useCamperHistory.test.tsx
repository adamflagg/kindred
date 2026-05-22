/**
 * Tests for useCamperHistory — merges live current-year records with the shared
 * prior-year fetcher, applying AG collapse/relabel to the current year too.
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper, expectDefined } from '../../test/testUtils'
import { useCamperHistory } from './useCamperHistory'
import type { Camper } from '../../types/app-types'

const mockFetchCamperJourney = vi.fn()
const mockFetchParentMainSessions = vi.fn()
vi.mock('./fetchCamperJourney', () => ({
  fetchCamperJourney: (...args: unknown[]) => mockFetchCamperJourney(...args),
  fetchParentMainSessions: (...args: unknown[]) => mockFetchParentMainSessions(...args),
}))

const YEAR = 2026

function currentCamper(opts: {
  sessionCmId: number
  sessionType: string
  parentId?: number
  bunkName?: string
}): Camper {
  return {
    person_cm_id: 12887873,
    attendee_status: 'enrolled',
    session_cm_id: opts.sessionCmId,
    expand: {
      session: {
        cm_id: opts.sessionCmId,
        name: `Session ${opts.sessionCmId}`,
        session_type: opts.sessionType,
        start_date: '',
        end_date: '',
        ...(opts.parentId !== undefined ? { parent_id: opts.parentId } : {}),
      },
      assigned_bunk: opts.bunkName ? { name: opts.bunkName } : null,
    },
  } as unknown as Camper
}

describe('useCamperHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCamperJourney.mockResolvedValue([])
    mockFetchParentMainSessions.mockResolvedValue(new Map())
  })

  it('merges current-year + prior fetcher rows and surfaces a 2022 gap year, sorted -year', async () => {
    mockFetchCamperJourney.mockResolvedValue([
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      { year: 2022, sessionName: 'Session 3', sessionType: 'main' }, // CM gap: no bunk
    ])
    const camper = currentCamper({ sessionCmId: 500, sessionType: 'main', bunkName: 'Cabin 5' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, camper, [camper]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.camperHistory.map((r) => r.year)).toEqual([2026, 2023, 2022])
    const r2022 = expectDefined(result.current.camperHistory.find((r) => r.year === 2022))
    expect(r2022.bunkName).toBeUndefined()
  })

  it('does not stamp "Unassigned" on a current-year teen record', async () => {
    const teen = currentCamper({ sessionCmId: 700, sessionType: 'scit' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, teen, [teen]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBeUndefined()
  })

  it('still stamps "Unassigned" on a current-year bunkable (main) record with no bunk', async () => {
    const unplaced = currentCamper({ sessionCmId: 500, sessionType: 'main' })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, unplaced, [unplaced]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.bunkName).toBe('Unassigned')
  })

  it('collapses a current-year Main + AG enrollment into one Main row', async () => {
    const main = currentCamper({ sessionCmId: 100, sessionType: 'main' })
    const ag = currentCamper({ sessionCmId: 101, sessionType: 'ag', parentId: 100 })
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, main, [main, ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = result.current.camperHistory.filter((r) => r.year === YEAR)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ sessionType: 'main', sessionName: 'Session 100' })
  })

  it('relabels a current-year AG-only camper to its parent main (never session_type ag)', async () => {
    const ag = currentCamper({ sessionCmId: 200, sessionType: 'ag', parentId: 199 })
    mockFetchParentMainSessions.mockResolvedValue(
      new Map([
        [
          '2026:199',
          {
            cm_id: 199,
            year: 2026,
            name: 'Session B',
            session_type: 'main',
            start_date: '',
            end_date: '',
          },
        ],
      ])
    )
    const { result } = renderHook(() => useCamperHistory(12887873, YEAR, ag, [ag]), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const current = expectDefined(result.current.camperHistory.find((r) => r.year === YEAR))
    expect(current.sessionType).toBe('main')
    expect(current.sessionName).toBe('Session B')
    expect(mockFetchParentMainSessions).toHaveBeenCalledWith([{ year: 2026, cmId: 199 }])
  })
})
