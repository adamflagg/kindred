/**
 * The lodging API client must route through fetchWithAuth.
 *
 * The PocketBase JWT lives in localStorage, not in a cookie, so a raw
 * `fetch(url, { credentials: 'include' })` silently 401s on every protected
 * FastAPI endpoint. Services take fetchWithAuth as a parameter; they never
 * import it (see frontend/CLAUDE.md, "Auth — easy to get wrong").
 */
import { describe, expect, it, vi } from 'vitest'

import {
  fetchHouseholdMedical,
  fetchWeekendRoster,
  fetchWeekendSessions,
  fetchWeekendSummary,
} from './lodgingApi'

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('fetchWeekendSessions', () => {
  it('calls the sessions endpoint through fetchWithAuth with the year', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ year: 2026, sessions: [] }))

    const result = await fetchWeekendSessions(mockFetch, 2026)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/sessions?year=2026')
    expect(result).toEqual({ year: 2026, sessions: [] })
  })

  it('throws with the status when the response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    })

    await expect(fetchWeekendSessions(mockFetch, 2026)).rejects.toThrow(/401/)
  })
})

describe('fetchWeekendSummary', () => {
  it('asks for the whole year in one request', () => {
    // The lander used to call the roster once per weekend; that endpoint's
    // cost is dominated by year-scoped work identical across weekends.
    const mockFetch = vi.fn().mockResolvedValue(okResponse({ year: 2026, weekends: [] }))

    return fetchWeekendSummary(mockFetch, 2026).then(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toBe('/api/lodging/summary?year=2026')
    })
  })

  it('surfaces a failure rather than rendering an empty lander', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(fetchWeekendSummary(mockFetch, 2026)).rejects.toThrow(/500/)
  })
})

describe('fetchWeekendRoster', () => {
  it('passes both year and session_cm_id', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ year: 2026, session_cm_id: 1000001, parties: [], units: [], counts: {} })
      )

    await fetchWeekendRoster(mockFetch, 2026, 1000001)

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/roster?year=2026&session_cm_id=1000001')
  })

  it('surfaces a FastAPI HTTPException detail when the body has one', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        detail: 'No family or adult session with CampMinder id 9999999 in 2026',
      }),
    })

    await expect(fetchWeekendRoster(mockFetch, 2026, 9999999)).rejects.toThrow(
      /No family or adult session with CampMinder id 9999999/
    )
  })
})

describe('fetchHouseholdMedical', () => {
  it('hits the permission-gated PHI endpoint through fetchWithAuth', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse({ household_cm_id: 2000001, year: 2026 }))

    await fetchHouseholdMedical(mockFetch, 2026, 2000001)

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('/api/lodging/households/2000001/medical?year=2026')
  })

  it('reports a 403 clearly so the UI can show a permission message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Permission required: lodging.phi' }),
    })

    await expect(fetchHouseholdMedical(mockFetch, 2026, 2000001)).rejects.toThrow(/lodging\.phi/)
  })
})
