import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getTourStorage,
  isTourCompleted,
  markTourCompleted,
  resetTour,
  resetAllTours,
  TOUR_STORAGE_KEY,
} from './tourStorage'

describe('tourStorage', () => {
  beforeEach(() => {
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockClear()
  })

  describe('getTourStorage', () => {
    it('returns empty completed map when localStorage is empty', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)
      const storage = getTourStorage()
      expect(storage).toEqual({ completed: {} })
    })

    it('parses valid stored data', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))
      const storage = getTourStorage()
      expect(storage).toEqual(stored)
    })

    it('returns empty completed map on invalid JSON', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('not valid json{{{')
      const storage = getTourStorage()
      expect(storage).toEqual({ completed: {} })
    })

    it('reads from the correct storage key', () => {
      getTourStorage()
      expect(localStorage.getItem).toHaveBeenCalledWith(TOUR_STORAGE_KEY)
    })
  })

  describe('isTourCompleted', () => {
    it('returns false when tour has never been completed', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ completed: {} }))
      expect(isTourCompleted('debug', 1)).toBe(false)
    })

    it('returns true when tour completed at same version', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))
      expect(isTourCompleted('debug', 1)).toBe(true)
    })

    it('returns true when tour completed at higher version', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 3, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))
      expect(isTourCompleted('debug', 2)).toBe(true)
    })

    it('returns false when tour version bumped beyond completed version', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))
      expect(isTourCompleted('debug', 2)).toBe(false)
    })
  })

  describe('markTourCompleted', () => {
    it('stores completion record with tour id, version, and timestamp', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ completed: {} }))

      markTourCompleted('debug', 1)

      expect(localStorage.setItem).toHaveBeenCalledWith(
        TOUR_STORAGE_KEY,
        expect.stringContaining('"tourId":"debug"')
      )
      expect(localStorage.setItem).toHaveBeenCalledWith(
        TOUR_STORAGE_KEY,
        expect.stringContaining('"completedVersion":1')
      )
      expect(localStorage.setItem).toHaveBeenCalledWith(
        TOUR_STORAGE_KEY,
        expect.stringContaining('"completedAt"')
      )
    })

    it('preserves other completed tours', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))

      // Mark a hypothetical second tour (using 'debug' again since it's the only TourId)
      markTourCompleted('debug', 2)

      const setCall = vi.mocked(localStorage.setItem).mock.calls[0]
      const savedData = JSON.parse(setCall[1])
      expect(savedData.completed.debug.completedVersion).toBe(2)
    })
  })

  describe('resetTour', () => {
    it('removes a specific tour from completed records', () => {
      const stored = {
        completed: {
          debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01T00:00:00Z' },
        },
      }
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored))

      resetTour('debug')

      const setCall = vi.mocked(localStorage.setItem).mock.calls[0]
      const savedData = JSON.parse(setCall[1])
      expect(savedData.completed.debug).toBeUndefined()
    })
  })

  describe('resetAllTours', () => {
    it('removes the entire storage key', () => {
      resetAllTours()
      expect(localStorage.removeItem).toHaveBeenCalledWith(TOUR_STORAGE_KEY)
    })
  })
})
