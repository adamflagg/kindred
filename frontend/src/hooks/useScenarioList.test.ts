/**
 * Contract tests for useScenarioList hook.
 *
 * Pins:
 * - Filters by `year` so the dropdown shows only the current year's scenarios
 *   (saved_scenarios accumulates across years).
 * - Uses `expand: 'session'` so we can resolve the related session's CampMinder
 *   id — saved_scenarios.session is a PocketBase relation, not a CampMinder id.
 * - The `session_id` returned to consumers is the CampMinder id, not the
 *   PocketBase relation id (CLAUDE.md: cross-table relationships use CM IDs).
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { createWrapper } from '../test/testUtils'
import { useScenarioList } from './useScenarioList'

const mockGetFullList = vi.fn()
const mockCollection = vi.fn((_name: string) => ({ getFullList: mockGetFullList }))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => mockCollection(name),
  },
}))

vi.mock('./useCurrentYear', () => ({
  useYear: () => 2026,
}))

beforeEach(() => {
  mockGetFullList.mockReset()
  mockCollection.mockClear()
  mockGetFullList.mockResolvedValue([])
})

describe('useScenarioList', () => {
  it('filters by year and expands the session relation', async () => {
    const { result } = renderHook(() => useScenarioList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const callArg = mockGetFullList.mock.calls[0]?.[0] as
      | { filter?: string; expand?: string }
      | undefined
    expect(callArg?.filter).toContain('year = 2026')
    expect(callArg?.expand).toBe('session')
  })

  it('maps the expanded session.cm_id to session_id (CampMinder id, not PB relation id)', async () => {
    mockGetFullList.mockResolvedValueOnce([
      {
        id: 'sc1',
        name: 'Test scenario',
        session: 'pb_session_internal_id',
        expand: { session: { cm_id: 1000002 } },
      },
    ])
    const { result } = renderHook(() => useScenarioList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      {
        id: 'sc1',
        name: 'Test scenario',
        session_id: 1000002,
      },
    ])
  })
})
