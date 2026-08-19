/**
 * TDD tests for useSheetsWorkbooks.
 *
 * The admin Sheets tab is about the DATA export workbooks — Globals and one per
 * year. Family Camp roster workbooks (kindred#2433) share the sheets_workbooks
 * collection but are a different surface: one per weekend, in a Drive folder
 * with a deliberately narrower audience, reached through the roster toolbar
 * rather than here.
 *
 * They must not reach this list. SheetsTab renders every non-globals row as
 * `String(workbook.year)`, so 2026's eight enrolled weekends would arrive as
 * eight rows all labelled "2026", indistinguishable from the real 2026 data
 * workbook and each linking somewhere else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetFullList = vi.fn()

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: mockGetFullList,
    })),
  },
}))

describe('useSheetsWorkbooks', () => {
  beforeEach(() => {
    mockGetFullList.mockReset()
    mockGetFullList.mockResolvedValue([])
  })

  describe('SHEETS_WORKBOOK_LIST_FILTER', () => {
    it('excludes Family Camp roster workbooks', async () => {
      const { SHEETS_WORKBOOK_LIST_FILTER } = await import('./useSheetsWorkbooks')
      expect(SHEETS_WORKBOOK_LIST_FILTER).toContain('fc_roster')
      expect(SHEETS_WORKBOOK_LIST_FILTER).toMatch(/workbook_type\s*!=/)
    })

    it('is applied to the sheets_workbooks query', async () => {
      const { fetchSheetsWorkbooks, SHEETS_WORKBOOK_LIST_FILTER } =
        await import('./useSheetsWorkbooks')

      await fetchSheetsWorkbooks()

      expect(mockGetFullList).toHaveBeenCalledTimes(1)
      expect(mockGetFullList).toHaveBeenCalledWith(
        expect.objectContaining({ filter: SHEETS_WORKBOOK_LIST_FILTER })
      )
    })

    it('keeps the existing year-descending sort', async () => {
      const { fetchSheetsWorkbooks } = await import('./useSheetsWorkbooks')

      await fetchSheetsWorkbooks()

      expect(mockGetFullList).toHaveBeenCalledWith(
        expect.objectContaining({ sort: '-year,workbook_type' })
      )
    })

    // The hook has always swallowed a failed load and rendered an empty tab
    // rather than an error. Pinned so the filter change does not alter it.
    it('returns an empty list when the query fails', async () => {
      const { fetchSheetsWorkbooks } = await import('./useSheetsWorkbooks')
      mockGetFullList.mockRejectedValue(new Error('offline'))

      await expect(fetchSheetsWorkbooks()).resolves.toEqual([])
    })
  })

  describe('hook export', () => {
    it('exports useSheetsWorkbooks', async () => {
      const module = await import('./useSheetsWorkbooks')
      expect(typeof module.useSheetsWorkbooks).toBe('function')
    })
  })
})
