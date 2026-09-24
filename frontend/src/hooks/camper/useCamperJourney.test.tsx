/**
 * useCamperJourney — the one feed every journey surface reads, now one
 * server call (kindred#2776).
 *
 * `personJourneyFacts` and the merge moved to the server with their tests
 * (`tests/unit/api/services/test_camper_journey_service.py`). What stays here
 * is the hook's own contract: it waits for auth, sends the JWT, keys on the
 * person and year, and never shows one journey while another loads.
 *
 * `useApiWithAuth` is deliberately NOT mocked: the header assertion below
 * reads what reaches the network, which is the only thing that proves the
 * PocketBase JWT (localStorage, not a cookie) travels.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiCamperJourneyResponse } from '../../types/api-types'
import { useCamperJourney } from './useCamperJourney'

const PERSON = 3000001
const OTHER_PERSON = 3000002
const YEAR = 2026

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))

const auth = { value: { isLoading: false, user: { id: 'u1' } } }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.value }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const PAYLOAD: ApiCamperJourneyResponse = {
  rows: [
    {
      year: 2024,
      session_name: 'Session 2',
      session_type: 'main',
      bunk_name: 'G-8B',
      bunk_name_recorded: null,
      start_date: '2024-06-16 00:00:00.000Z',
      end_date: '2024-07-06 00:00:00.000Z',
    },
  ],
  counts: { summers: 3, family_weekends: 2, adult_weekends: 5 },
  teen_cabins: [
    { year: 2026, session_cm_id: 2001, cabin_name: 'Village Cabin 2', cabin_name_raw: 'Teen 2' },
  ],
}

const JOURNEY_ROW = {
  year: 2024,
  sessionName: 'Session 2',
  sessionType: 'main',
  bunkName: 'G-8B',
  startDate: '2024-06-16 00:00:00.000Z',
  endDate: '2024-07-06 00:00:00.000Z',
}

function respond(body: ApiCamperJourneyResponse, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function calledUrls(): string[] {
  return fetchSpy.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  auth.value = { isLoading: false, user: { id: 'u1' } }
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond(PAYLOAD))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('useCamperJourney', () => {
  it('sends the protected read through fetchWithAuth, carrying the PocketBase JWT', async () => {
    renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/campers/${String(PERSON)}/journey?year=${String(YEAR)}`)
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('withholds the read while auth is still loading', async () => {
    auth.value = { isLoading: true, user: { id: 'u1' } }
    const { result, rerender } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await flush()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(true)

    auth.value = { isLoading: false, user: { id: 'u1' } }
    rerender()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
  })

  it('reads nothing for no person', async () => {
    const { result } = renderHook(() => useCamperJourney(null, YEAR), { wrapper })
    await flush()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.rows).toEqual([])
  })

  it("returns the server's rows and counts", async () => {
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))
    expect(result.current.counts).toEqual({ summers: 3, familyWeekends: 2, adultWeekends: 5 })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  // kindred#2812: what the current-year build needs from the feed — a
  // parent's current-year family rows, and the attributed adult cabins.
  it("returns a parent's current-year family rows apart from the prior years", async () => {
    fetchSpy.mockImplementation(() =>
      respond({
        ...PAYLOAD,
        current_year_parent_rows: [
          {
            year: 2026,
            session_name: 'Family Camp 6',
            session_type: 'family',
            bunk_name: 'Meadow House 1',
            bunk_name_recorded: null,
            start_date: null,
            end_date: null,
          },
        ],
      })
    )
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.currentYearParentRows).toHaveLength(1))
    expect(result.current.currentYearParentRows[0]).toEqual({
      year: 2026,
      sessionName: 'Family Camp 6',
      sessionType: 'family',
      bunkName: 'Meadow House 1',
    })
    expect(result.current.rows).toEqual([JOURNEY_ROW])
  })

  it('keys the attributed adult cabins by year and session for the current-year rows', async () => {
    fetchSpy.mockImplementation(() =>
      respond({
        ...PAYLOAD,
        adult_cabins: [
          { year: 2026, session_cm_id: 1001, cabin_name: 'River F', cabin_name_raw: 'River F' },
        ],
      })
    )
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.adultCabinsByWeekend.size).toBe(1))
    expect(result.current.adultCabinsByWeekend.get('2026:1001')).toEqual({
      cabinName: 'River F',
      cabinNameRaw: 'River F',
    })
  })

  it('reports no current-year parent rows until the journey lands', () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    expect(result.current.currentYearParentRows).toEqual([])
    expect(result.current.adultCabinsByWeekend.size).toBe(0)
  })

  it('reports empty counts until the journey lands', () => {
    fetchSpy.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    expect(result.current.counts).toEqual({ summers: 0, familyWeekends: 0, adultWeekends: 0 })
    expect(result.current.isLoading).toBe(true)
  })

  it('keys the registry-resolved teen cabins by year and session for the current-year rows', async () => {
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.teenCabinsByWeekend.size).toBe(1))
    expect(result.current.teenCabinsByWeekend.get('2026:2001')).toEqual({
      cabinName: 'Village Cabin 2',
      cabinNameRaw: 'Teen 2',
    })
  })

  it('surfaces a failed read as the error, never as an empty journey', async () => {
    fetchSpy.mockImplementation(() => respond({}, 500))
    const { result } = renderHook(() => useCamperJourney(PERSON, YEAR), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.isLoading).toBe(false)
  })

  it("never shows one person's rows while another person's journey loads", async () => {
    const { result, rerender } = renderHook(({ id }) => useCamperJourney(id, YEAR), {
      wrapper,
      initialProps: { id: PERSON },
    })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))

    fetchSpy.mockImplementation(() => new Promise(() => {}))
    rerender({ id: OTHER_PERSON })
    await waitFor(() =>
      expect(calledUrls()).toContain(
        `/api/campers/${String(OTHER_PERSON)}/journey?year=${String(YEAR)}`
      )
    )
    await flush()
    expect(result.current.rows).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it("never shows the previous view year's rows while the new year loads", async () => {
    const { result, rerender } = renderHook(({ year }) => useCamperJourney(PERSON, year), {
      wrapper,
      initialProps: { year: YEAR },
    })
    await waitFor(() => expect(result.current.rows).toEqual([JOURNEY_ROW]))

    fetchSpy.mockImplementation(() => new Promise(() => {}))
    rerender({ year: YEAR - 1 })
    await waitFor(() =>
      expect(calledUrls()).toContain(
        `/api/campers/${String(PERSON)}/journey?year=${String(YEAR - 1)}`
      )
    )
    await flush()
    expect(result.current.rows).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })
})
