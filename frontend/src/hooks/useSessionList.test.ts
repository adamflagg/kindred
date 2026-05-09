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

  it('filters and sorts to mirror the bunking board (main+embedded, start_date then cm_id)', async () => {
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const callArg = mockGetFullList.mock.calls[0]?.[0] as
      | { filter?: string; sort?: string }
      | undefined
    expect(callArg?.filter).toBeDefined()
    expect(callArg?.filter).toContain('year = 2026')
    expect(callArg?.filter).toContain('session_type = "main"')
    expect(callArg?.filter).toContain('session_type = "embedded"')
    // Family-camp / quest / AG / etc. must NOT leak in.
    expect(callArg?.filter).not.toContain('session_type = "ag"')
    expect(callArg?.filter).not.toContain('session_type = "family"')
    expect(callArg?.filter).not.toContain('session_type = "quest"')
    // Sort matches SessionList.tsx so the dropdown order matches the bunking nav.
    expect(callArg?.sort).toBe('start_date,cm_id')
  })

  it('returns mapped session items reading the actual PB schema field "name" (not "session_name")', async () => {
    // The camp_sessions PB collection has field `name`, not `session_name`. The
    // previous implementation read `r.session_name` and got undefined, so the
    // session dropdown rendered as " — 2026 (0)" with no actual name visible.
    mockGetFullList.mockResolvedValueOnce([
      {
        id: 'rec1',
        cm_id: 1000002,
        name: 'Session 2',
        year: 2026,
      },
    ])
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      {
        id: 'rec1',
        cm_id: 1000002,
        name: 'Session 2',
        year: 2026,
      },
    ])
  })

  it('does NOT crash or invent an attendee_count field (none exists on camp_sessions)', async () => {
    mockGetFullList.mockResolvedValueOnce([
      { id: 'rec1', cm_id: 1000002, name: 'Session 2', year: 2026 },
    ])
    const { result } = renderHook(() => useSessionList(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]).not.toHaveProperty('attendee_count')
  })
})
