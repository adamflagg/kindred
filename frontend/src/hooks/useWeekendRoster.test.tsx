/**
 * Roster hooks: keys come from the central factory, and the PHI query is
 * opt-in so it never fires for users who cannot see the narrative.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import {
  useHouseholdMedical,
  useWeekendRoster,
  useWeekendSessions,
  useWeekendSummary,
} from './useWeekendRoster'

const fetchWeekendSessions = vi.fn()
const fetchWeekendSummary = vi.fn()
const fetchWeekendRoster = vi.fn()
const fetchHouseholdMedical = vi.fn()

vi.mock('../services/lodgingApi', () => ({
  fetchWeekendSessions: (...args: unknown[]) => fetchWeekendSessions(...args),
  fetchWeekendSummary: (...args: unknown[]) => fetchWeekendSummary(...args),
  fetchWeekendRoster: (...args: unknown[]) => fetchWeekendRoster(...args),
  fetchHouseholdMedical: (...args: unknown[]) => fetchHouseholdMedical(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  fetchWeekendSessions.mockReset().mockResolvedValue({ year: 2026, sessions: [] })
  fetchWeekendSummary.mockReset().mockResolvedValue({ year: 2026, weekends: [] })
  fetchWeekendRoster.mockReset().mockResolvedValue({ year: 2026, session_cm_id: 1000001 })
  fetchHouseholdMedical.mockReset().mockResolvedValue({ household_cm_id: 2000001, year: 2026 })
})

describe('queryKeys', () => {
  it('exposes stable lodging keys', () => {
    expect(queryKeys.weekendSessions(2026)).toEqual(['weekend-sessions', 2026])
    expect(queryKeys.weekendRoster(2026, 1000001)).toEqual(['weekend-roster', 2026, 1000001])
    expect(queryKeys.householdMedical(2026, 2000001)).toEqual(['household-medical', 2026, 2000001])
    expect(queryKeys.lodgingUnits()).toEqual(['lodging-units'])
    expect(queryKeys.lodgingAreas()).toEqual(['lodging-areas'])
    expect(queryKeys.lodgingAliases()).toEqual(['lodging-aliases'])
    expect(queryKeys.weekendSummary(2026)).toEqual(['weekend-summary', 2026])
    expect(queryKeys.lodgingIngestIssues()).toEqual(['lodging-ingest-issues'])
  })
})

describe('useWeekendSessions', () => {
  it('fetches the session list for the year', async () => {
    const { result } = renderHook(() => useWeekendSessions(2026), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendSessions).toHaveBeenCalledTimes(1)
    const [, year] = fetchWeekendSessions.mock.calls[0] as [unknown, number]
    expect(year).toBe(2026)
  })
})

describe('useWeekendSummary', () => {
  it('fetches the whole year once, which is the point of it', async () => {
    const { result } = renderHook(() => useWeekendSummary(2026), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchWeekendSummary).toHaveBeenCalledTimes(1)
    const [, year] = fetchWeekendSummary.mock.calls[0] as [unknown, number]
    expect(year).toBe(2026)
  })
})

describe('useWeekendRoster', () => {
  it('does not fetch until a session is chosen', () => {
    renderHook(() => useWeekendRoster(2026, null), { wrapper })
    expect(fetchWeekendRoster).not.toHaveBeenCalled()
  })

  it('fetches once a session is chosen', async () => {
    const { result } = renderHook(() => useWeekendRoster(2026, 1000001), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [, year, sessionCmId] = fetchWeekendRoster.mock.calls[0] as [unknown, number, number]
    expect([year, sessionCmId]).toEqual([2026, 1000001])
  })
})

describe('useHouseholdMedical', () => {
  it('stays idle while disabled, so PHI is never fetched speculatively', () => {
    renderHook(() => useHouseholdMedical(2026, 2000001, false), { wrapper })
    expect(fetchHouseholdMedical).not.toHaveBeenCalled()
  })

  it('fetches only when explicitly enabled', async () => {
    const { result } = renderHook(() => useHouseholdMedical(2026, 2000001, true), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchHouseholdMedical).toHaveBeenCalledTimes(1)
  })
})
