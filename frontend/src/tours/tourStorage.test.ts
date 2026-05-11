import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import {
  getTourStorage,
  markLayerCompleted,
  batchComplete,
  getLayerCompletion,
  isLayerSeen,
  isLayerStaleOrUnseen,
  resetAllTours,
  TOUR_STORAGE_KEY,
} from './tourStorage'

// Use real localStorage for these tests (the global setup mocks it)
const realLocalStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    length: 0,
    key: vi.fn(),
  }
})()

describe('tourStorage', () => {
  beforeAll(() => {
    vi.stubGlobal('localStorage', realLocalStorage)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    localStorage.removeItem(TOUR_STORAGE_KEY)
  })

  describe('backward compatibility', () => {
    it('handles legacy storage shape that still has a completed field', () => {
      localStorage.setItem(
        TOUR_STORAGE_KEY,
        JSON.stringify({
          completed: { debug: { tourId: 'debug', completedVersion: 1, completedAt: '2026-01-01' } },
          layers: {},
        })
      )
      const storage = getTourStorage()
      expect(storage.layers).toEqual({})
    })

    it('handles storage that only has layers', () => {
      localStorage.setItem(
        TOUR_STORAGE_KEY,
        JSON.stringify({
          layers: {
            'metrics-header': {
              layerId: 'metrics-header',
              completedVersion: 1,
              completedAt: '2026-01-01',
            },
          },
        })
      )
      const storage = getTourStorage()
      expect(storage.layers['metrics-header']).toBeDefined()
    })
  })

  describe('markLayerCompleted', () => {
    it('persists layer completion with timestamp', () => {
      markLayerCompleted('metrics-header', 1)
      const record = getLayerCompletion('metrics-header')
      expect(record).not.toBeNull()
      expect(record!.layerId).toBe('metrics-header')
      expect(record!.completedVersion).toBe(1)
      expect(record!.completedAt).toBeTruthy()
    })

    it('updates version on re-completion', () => {
      markLayerCompleted('metrics-header', 1)
      markLayerCompleted('metrics-header', 2)
      const record = getLayerCompletion('metrics-header')
      expect(record!.completedVersion).toBe(2)
    })
  })

  describe('getLayerCompletion', () => {
    it('returns null for unseen layers', () => {
      expect(getLayerCompletion('metrics-header')).toBeNull()
    })
  })

  describe('isLayerSeen', () => {
    it('returns false for unseen layers', () => {
      expect(isLayerSeen('metrics-header')).toBe(false)
    })

    it('returns true for seen layers regardless of version', () => {
      markLayerCompleted('metrics-header', 1)
      expect(isLayerSeen('metrics-header')).toBe(true)
    })
  })

  describe('isLayerStaleOrUnseen', () => {
    it('returns true for unseen layers', () => {
      expect(isLayerStaleOrUnseen('metrics-header', 1, 30)).toBe(true)
    })

    it('returns true when version is bumped', () => {
      markLayerCompleted('metrics-header', 1)
      expect(isLayerStaleOrUnseen('metrics-header', 2, 30)).toBe(true)
    })

    it('returns false for recently seen layers at current version', () => {
      markLayerCompleted('metrics-header', 1)
      expect(isLayerStaleOrUnseen('metrics-header', 1, 30)).toBe(false)
    })

    it('returns true for stale layers', () => {
      const storage = getTourStorage()
      storage.layers['metrics-header'] = {
        layerId: 'metrics-header',
        completedVersion: 1,
        completedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      }
      localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
      expect(isLayerStaleOrUnseen('metrics-header', 1, 30)).toBe(true)
    })
  })

  describe('batchComplete', () => {
    it('writes multiple layers in a single localStorage write', () => {
      batchComplete([
        { layerId: 'metrics-header', version: 1 },
        { layerId: 'registration-intro', version: 1 },
      ])
      const storage = getTourStorage()
      expect(storage.layers['metrics-header']?.completedVersion).toBe(1)
      expect(storage.layers['registration-intro']?.completedVersion).toBe(1)
    })

    it('is a no-op when given an empty array', () => {
      batchComplete([])
      const storage = getTourStorage()
      expect(storage.layers).toEqual({})
    })
  })

  describe('resetAllTours', () => {
    it('clears layer storage', () => {
      markLayerCompleted('metrics-header', 1)
      resetAllTours()
      const storage = getTourStorage()
      expect(storage.layers).toEqual({})
    })
  })
})
