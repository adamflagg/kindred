/**
 * Tests for scenarioStorage utility — localStorage persistence for last active scenario.
 *
 * Covers scoreboard item #49: bunking board should restore the last active scenario
 * on refresh/mount instead of defaulting to CampMinder source-of-truth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getStoredScenarioId,
  setStoredScenarioId,
  clearStoredScenarioId,
  SCENARIO_STORAGE_KEY,
} from './scenarioStorage'

// The global test setup stubs localStorage with non-functional vi.fn()s.
// Override with a real in-memory implementation so read/write/clear actually work.
function makeLocalStorageMock() {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      Reflect.deleteProperty(store, key)
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    length: 0,
    key: vi.fn(),
  }
}

describe('scenarioStorage', () => {
  beforeEach(() => {
    const mock = makeLocalStorageMock()
    Object.defineProperty(window, 'localStorage', { value: mock, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getStoredScenarioId', () => {
    it('returns null when nothing is stored for the session', () => {
      expect(getStoredScenarioId(1001)).toBeNull()
    })

    it('returns the stored scenario id for the given session', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '1001': 'scenario-abc' }))
      expect(getStoredScenarioId(1001)).toBe('scenario-abc')
    })

    it('returns null when a different session is stored but not this one', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '9999': 'scenario-xyz' }))
      expect(getStoredScenarioId(1001)).toBeNull()
    })

    it('returns null when localStorage contains invalid JSON', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, 'not-valid-json')
      expect(getStoredScenarioId(1001)).toBeNull()
    })

    it('returns null when sessionId is falsy', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '0': 'scenario-abc' }))
      expect(getStoredScenarioId(0)).toBeNull()
    })
  })

  describe('setStoredScenarioId', () => {
    it('stores the scenario id under the session key', () => {
      setStoredScenarioId(1001, 'scenario-abc')
      const stored = JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? '{}')
      expect(stored['1001']).toBe('scenario-abc')
    })

    it('preserves existing entries for other sessions', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '9999': 'scenario-xyz' }))
      setStoredScenarioId(1001, 'scenario-abc')
      const stored = JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? '{}')
      expect(stored['9999']).toBe('scenario-xyz')
      expect(stored['1001']).toBe('scenario-abc')
    })

    it('does nothing when sessionId is falsy', () => {
      setStoredScenarioId(0, 'scenario-abc')
      expect(localStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull()
    })
  })

  describe('clearStoredScenarioId', () => {
    it('removes the scenario entry for the given session', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '1001': 'scenario-abc' }))
      clearStoredScenarioId(1001)
      const stored = JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? '{}')
      expect(stored['1001']).toBeUndefined()
    })

    it('leaves other session entries intact', () => {
      localStorage.setItem(
        SCENARIO_STORAGE_KEY,
        JSON.stringify({ '1001': 'scenario-abc', '9999': 'scenario-xyz' })
      )
      clearStoredScenarioId(1001)
      const stored = JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? '{}')
      expect(stored['9999']).toBe('scenario-xyz')
    })

    it('does nothing when sessionId is falsy', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '1001': 'scenario-abc' }))
      clearStoredScenarioId(0)
      // nothing removed
      expect(JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY) ?? '{}')).toEqual({
        '1001': 'scenario-abc',
      })
    })

    // Finding 3: write-side error handling — clearStoredScenarioId must not throw
    it('does not throw when localStorage.setItem throws SecurityError', () => {
      localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ '1001': 'scenario-abc' }))
      vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('SecurityError', 'SecurityError')
      })
      expect(() => clearStoredScenarioId(1001)).not.toThrow()
    })
  })

  // Finding 3: write-side error handling for setStoredScenarioId
  describe('setStoredScenarioId — error handling', () => {
    it('does not throw when localStorage.setItem throws QuotaExceededError', () => {
      vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
        const err = new DOMException('QuotaExceededError')
        Object.defineProperty(err, 'name', { value: 'QuotaExceededError' })
        throw err
      })
      expect(() => setStoredScenarioId(1001, 'scenario-abc')).not.toThrow()
    })

    it('does not throw when localStorage.setItem throws SecurityError', () => {
      vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('SecurityError', 'SecurityError')
      })
      expect(() => setStoredScenarioId(1001, 'scenario-abc')).not.toThrow()
    })
  })
})
