/**
 * Contract tests for useSessionList hook.
 *
 * Pins:
 * - Queries the `camp_sessions` collection (not `sessions` — there is no
 *   `sessions` collection in the schema).
 * - Filters by `year` so cross-year session IDs do not contaminate the dropdown.
 * - Filters by `session_type` against SUMMER_CAMP_TYPES so family-camp sessions
 *   (TLI, teen, etc.) don't leak into solver views.
 *
 * TDD: Tests written BEFORE implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { createWrapper } from '../test/testUtils'
import { useSessionList } from './useSessionList'
import { SUMMER_CAMP_TYPES } from '../utils/sessionTypePredicates'

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

describe('useSessionList', () => {
  it('queries the camp_sessions collection (not the non-existent sessions collection)', async () => {
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockCollection).toHaveBeenCalledWith('camp_sessions')
  })

  it('filters by year and SUMMER_CAMP_TYPES to keep family-camp sessions out of solver dropdowns', async () => {
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const callArg = mockGetFullList.mock.calls[0]?.[0] as { filter?: string } | undefined
    expect(callArg?.filter).toBeDefined()
    expect(callArg?.filter).toContain('year = 2026')
    for (const type of SUMMER_CAMP_TYPES) {
      expect(callArg?.filter).toContain(`session_type = "${type}"`)
    }
  })

  it('returns mapped session items with cm_id, name, year', async () => {
    mockGetFullList.mockResolvedValueOnce([
      {
        id: 'rec1',
        cm_id: 1000002,
        session_name: 'Session 2',
        year: 2026,
        attendee_count: 120,
      },
    ])
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      {
        id: 'rec1',
        cm_id: 1000002,
        session_name: 'Session 2',
        year: 2026,
        attendee_count: 120,
      },
    ])
  })
})
