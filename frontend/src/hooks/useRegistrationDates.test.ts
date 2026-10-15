/**
 * useRegistrationDates / usePriorityRegDate — the season's registration dates, as staff enter
 * them in Admin › Registration Dates (config rows: category "registration", subcategory = year).
 *
 * Analytics' empty season reads the priority date for its second line ("Priority registration
 * opens Wednesday, Nov 11."). The admin screen and the empty state share one query key, so a save
 * in Admin refreshes the line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createWrapper } from '../test/testUtils'
import { queryKeys } from '../utils/queryKeys'

const mockGetFullList = vi.fn()
const mockCollection = vi.fn((_name: string) => ({ getFullList: mockGetFullList }))

vi.mock('../lib/pocketbase', () => ({
  pb: { collection: (name: string) => mockCollection(name) },
}))

import {
  formatPriorityDate,
  usePriorityRegDate,
  useRegistrationDates,
} from './useRegistrationDates'

beforeEach(() => {
  mockGetFullList.mockReset()
  mockCollection.mockClear()
})

describe('useRegistrationDates', () => {
  it('reads the season’s registration config rows', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'a', config_key: 'priority_reg_date', value: '2026-11-11' },
    ])
    const { result } = renderHook(() => useRegistrationDates(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(mockCollection).toHaveBeenCalledWith('config')
    expect(mockGetFullList.mock.calls[0]?.[0]?.filter).toBe(
      'category = "registration" && subcategory = "2027"'
    )
  })

  it('keys on the shared registration-dates key, so an Admin save refreshes every reader', () => {
    expect(queryKeys.registrationDatesConfig(2027)).toEqual(['registration-dates-config', 2027])
  })
})

describe('usePriorityRegDate', () => {
  it('returns the configured priority date', async () => {
    mockGetFullList.mockResolvedValue([
      { id: 'a', config_key: 'early_reg_date', value: '2026-12-01' },
      { id: 'b', config_key: 'priority_reg_date', value: '2026-11-11' },
    ])
    const { result } = renderHook(() => usePriorityRegDate(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current).toBe('2026-11-11'))
  })

  it('returns undefined when the season has no priority date yet', async () => {
    mockGetFullList.mockResolvedValue([{ id: 'a', config_key: 'priority_reg_date', value: '' }])
    const { result } = renderHook(() => usePriorityRegDate(2027), { wrapper: createWrapper() })
    await waitFor(() => expect(mockGetFullList).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it('does not ask before the year is known', () => {
    renderHook(() => usePriorityRegDate(0), { wrapper: createWrapper() })
    expect(mockGetFullList).not.toHaveBeenCalled()
  })
})

describe('formatPriorityDate', () => {
  it('reads as a weekday and a short date', () => {
    expect(formatPriorityDate('2026-11-11')).toBe('Wednesday, Nov 11')
  })

  it('ignores a time part (config dates may carry one)', () => {
    expect(formatPriorityDate('2026-11-11 00:00:00.000Z')).toBe('Wednesday, Nov 11')
    expect(formatPriorityDate('2026-11-11T08:00:00Z')).toBe('Wednesday, Nov 11')
  })

  it('returns null for anything that is not a date', () => {
    expect(formatPriorityDate('')).toBeNull()
    expect(formatPriorityDate('soon')).toBeNull()
  })
})
