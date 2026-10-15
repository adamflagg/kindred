/**
 * useSeasonHasRows — does a season have any countable summer attendee rows?
 *
 * Analytics shows its empty state (PR 4, decision 41) only when the answer is no.
 * "Countable" is deliberately NOT "enrolled": 2020 has 0 enrolled but over a
 * thousand cancelled summer rows, and a zero-enrolled gate would blank its real
 * Cancellations and Retention history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'

const mockGetList = vi.fn()
const mockCollection = vi.fn((_name: string) => ({ getList: mockGetList }))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => mockCollection(name),
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false }),
}))

import { seasonRowsFilter, useSeasonHasRows } from './useSeasonHasRows'

beforeEach(() => {
  mockGetList.mockReset()
  mockCollection.mockClear()
})

describe('seasonRowsFilter', () => {
  const f = seasonRowsFilter(2027)

  it('is scoped to the one season', () => {
    expect(f).toContain('year = 2027')
  })

  it('counts the summer camp session types', () => {
    for (const t of ['main', 'embedded', 'ag', 'quest']) {
      expect(f).toContain(`session.session_type = "${t}"`)
    }
  })

  it('never counts Family Camp or adult weekends (Family Camp never folds into summer metrics)', () => {
    for (const t of ['family', 'family_adult', 'adult']) {
      expect(f).not.toContain(`"${t}"`)
    }
  })

  it('leaves out teen programs, which can run off-season (Feb, Sep, Oct) under the same year', () => {
    expect(f).not.toContain('"scit"')
    expect(f).not.toContain('"tli"')
  })

  it('leaves out status 1 (none) and 512 (incomplete), but keeps cancelled rows', () => {
    expect(f).toContain('status_id != 1')
    expect(f).toContain('status_id != 512')
    expect(f).not.toMatch(/status_id = 2\b/)
  })
})

describe('useSeasonHasRows', () => {
  it('asks attendees for a count only (one row, id field)', async () => {
    mockGetList.mockResolvedValue({ totalItems: 0, items: [] })
    const { result } = renderHook(() => useSeasonHasRows(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockCollection).toHaveBeenCalledWith('attendees')
    expect(mockGetList).toHaveBeenCalledWith(1, 1, {
      fields: 'id',
      filter: seasonRowsFilter(2027),
      skipTotal: false,
    })
  })

  it('reports an empty season when nothing countable exists', async () => {
    mockGetList.mockResolvedValue({ totalItems: 0, items: [] })
    const { result } = renderHook(() => useSeasonHasRows(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.hasRows).toBe(false))
  })

  it('reports rows for a cancelled-only season (2020-shaped)', async () => {
    mockGetList.mockResolvedValue({ totalItems: 1569, items: [{ id: 'x' }] })
    const { result } = renderHook(() => useSeasonHasRows(2020), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.hasRows).toBe(true))
  })

  it('is undefined while loading, so callers never flash the empty state', () => {
    mockGetList.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSeasonHasRows(2027), { wrapper: createWrapper() })
    expect(result.current.hasRows).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })

  it('does not query for year 0', () => {
    renderHook(() => useSeasonHasRows(0), { wrapper: createWrapper() })
    expect(mockGetList).not.toHaveBeenCalled()
  })

  it('fails open on an error: a broken count must not hide real data', async () => {
    mockGetList.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSeasonHasRows(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasRows).toBe(true)
  })
})
