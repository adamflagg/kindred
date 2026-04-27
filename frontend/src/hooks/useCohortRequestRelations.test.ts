/**
 * Tests for useCohortRequestRelations.
 *
 * Returns a map of (other_person_cm_id) → 'bunk_with' | 'not_bunk_with' for
 * confirmed (status='resolved' && requestee_id>0) bunk requests involving the
 * source camper, in either direction, scoped to a session/year.
 *
 * TDD: written before implementation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { useCohortRequestRelations } from './useCohortRequestRelations'

const mockGetFullList = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({ getFullList: mockGetFullList })),
  },
}))

function req(overrides: {
  requester_id: number
  requestee_id: number
  request_type: 'bunk_with' | 'not_bunk_with' | 'same_age'
  status?: 'resolved' | 'pending'
}) {
  return {
    id: `r-${overrides.requester_id}-${overrides.requestee_id}`,
    requester_id: overrides.requester_id,
    requestee_id: overrides.requestee_id,
    request_type: overrides.request_type,
    status: overrides.status ?? 'resolved',
  }
}

describe('useCohortRequestRelations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled (no fetch) when personCmId is null', () => {
    renderHook(() => useCohortRequestRelations(null, 201, 2025), {
      wrapper: createWrapper(),
    })
    expect(mockGetFullList).not.toHaveBeenCalled()
  })

  it('captures only incoming bunk_with requests (other → self), not outgoing-only', async () => {
    mockGetFullList.mockResolvedValue([
      // Self (1000001) requested Liam — outgoing-only, must NOT appear
      req({ requester_id: 1000001, requestee_id: 1000002, request_type: 'bunk_with' }),
      // Olivia requested self — incoming, must appear
      req({ requester_id: 1000003, requestee_id: 1000001, request_type: 'bunk_with' }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.get(1000002)).toBeUndefined()
    expect(result.current.relations.get(1000003)).toEqual({ type: 'bunk_with', mutual: false })
  })

  it('captures incoming not_bunk_with requests', async () => {
    mockGetFullList.mockResolvedValue([
      // Riley said "not with self"
      req({ requester_id: 1000004, requestee_id: 1000001, request_type: 'not_bunk_with' }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.get(1000004)).toEqual({ type: 'not_bunk_with', mutual: false })
  })

  it('marks mutual=true when self also requested the same other camper (same type)', async () => {
    mockGetFullList.mockResolvedValue([
      // Beckett requested Jesse (incoming)
      req({ requester_id: 1000005, requestee_id: 1000001, request_type: 'bunk_with' }),
      // Jesse requested Beckett (outgoing) — same pair, both directions
      req({ requester_id: 1000001, requestee_id: 1000005, request_type: 'bunk_with' }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.get(1000005)).toEqual({ type: 'bunk_with', mutual: true })
  })

  it('mutual flag is per-type — a not_bunk_with the other way does not mark bunk_with as mutual', async () => {
    mockGetFullList.mockResolvedValue([
      // Other → self: bunk_with
      req({ requester_id: 1000006, requestee_id: 1000001, request_type: 'bunk_with' }),
      // Self → other: NOT_bunk_with — opposite type, doesn't count as mutual
      req({ requester_id: 1000001, requestee_id: 1000006, request_type: 'not_bunk_with' }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.get(1000006)).toEqual({ type: 'bunk_with', mutual: false })
  })

  it('excludes pending (unconfirmed) requests', async () => {
    mockGetFullList.mockResolvedValue([
      req({
        requester_id: 1000001,
        requestee_id: 1000002,
        request_type: 'bunk_with',
        status: 'pending',
      }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.get(1000002)).toBeUndefined()
  })

  it('excludes confirmed requests with requestee_id <= 0 (unresolved target)', async () => {
    mockGetFullList.mockResolvedValue([
      {
        id: 'r-bad',
        requester_id: 1000001,
        requestee_id: 0,
        request_type: 'bunk_with',
        status: 'resolved',
      },
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.size).toBe(0)
  })

  it('ignores request_types other than bunk_with / not_bunk_with', async () => {
    mockGetFullList.mockResolvedValue([
      req({ requester_id: 1000001, requestee_id: 1000002, request_type: 'same_age' }),
    ])

    const { result } = renderHook(() => useCohortRequestRelations(1000001, 201, 2025), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.relations.size).toBe(0)
  })
})
