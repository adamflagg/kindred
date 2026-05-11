import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { getTourStorage, batchComplete, resetAllTours, TOUR_STORAGE_KEY } from './tourStorage'

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

  describe('getTourStorage', () => {
    it('returns an empty layers map when storage is empty', () => {
      expect(getTourStorage()).toEqual({ layers: {} })
    })

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

    it('returns empty shape on malformed JSON', () => {
      localStorage.setItem(TOUR_STORAGE_KEY, 'not-json')
      expect(getTourStorage()).toEqual({ layers: {} })
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

    it('overwrites existing layer records with newer versions', () => {
      batchComplete([{ layerId: 'metrics-header', version: 1 }])
      batchComplete([{ layerId: 'metrics-header', version: 2 }])
      const storage = getTourStorage()
      expect(storage.layers['metrics-header']?.completedVersion).toBe(2)
    })
  })

  describe('resetAllTours', () => {
    it('clears layer storage', () => {
      batchComplete([{ layerId: 'metrics-header', version: 1 }])
      resetAllTours()
      expect(getTourStorage().layers).toEqual({})
    })
  })
})
