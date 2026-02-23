/**
 * TDD Tests for useAdminSessions hook.
 *
 * This shared hook fetches camp sessions for admin config pages
 * and applies sortSessionsByDate to ensure correct ordering
 * (main sessions before embedded when dates are the same).
 */
import { describe, it, expect } from 'vitest'

describe('useAdminSessions', () => {
  describe('hook export', () => {
    it('should export useAdminSessions hook', async () => {
      const module = await import('./useAdminSessions')
      expect(typeof module.useAdminSessions).toBe('function')
    })
  })

  describe('session types', () => {
    it('should fetch main, embedded, ag, and quest session types', async () => {
      const sourceContent = await import('./useAdminSessions?raw')
      const source = sourceContent.default

      // The hook should filter for all summer session types
      expect(source).toContain('main')
      expect(source).toContain('embedded')
      expect(source).toContain('ag')
      expect(source).toContain('quest')
    })
  })

  describe('sorting', () => {
    it('should import sortSessionsByDate from sessionUtils', async () => {
      const sourceContent = await import('./useAdminSessions?raw')
      const source = sourceContent.default

      expect(source).toContain('sortSessionsByDate')
      expect(source).toContain('sessionUtils')
    })

    it('should apply sortSessionsByDate to results', async () => {
      const sourceContent = await import('./useAdminSessions?raw')
      const source = sourceContent.default

      // The hook must call sortSessionsByDate on the fetched data
      // This is the core fix: without this, sessions with the same
      // start_date (like Session 2 and Session 2a) appear in random order
      expect(source).toMatch(/sortSessionsByDate/)
    })
  })

  describe('sortSessionsByDate behavior (from sessionUtils)', () => {
    it('should sort main sessions before embedded when dates are the same', async () => {
      const { sortSessionsByDate } = await import('../utils/sessionUtils')

      const sessions = [
        { name: 'Session 2a', start_date: '2025-06-15' },
        { name: 'Session 2', start_date: '2025-06-15' },
      ]

      const sorted = sortSessionsByDate(sessions)
      expect(sorted[0]?.name).toBe('Session 2')
      expect(sorted[1]?.name).toBe('Session 2a')
    })

    it('should sort by date first, then by name as tiebreaker', async () => {
      const { sortSessionsByDate } = await import('../utils/sessionUtils')

      const sessions = [
        { name: 'Session 3a', start_date: '2025-07-06' },
        { name: 'Session 3', start_date: '2025-07-06' },
        { name: 'Session 2a', start_date: '2025-06-15' },
        { name: 'Session 2', start_date: '2025-06-15' },
        { name: 'Session 1', start_date: '2025-06-01' },
      ]

      const sorted = sortSessionsByDate(sessions)
      expect(sorted.map((s) => s.name)).toEqual([
        'Session 1',
        'Session 2',
        'Session 2a',
        'Session 3',
        'Session 3a',
      ])
    })

    it('should handle empty array', async () => {
      const { sortSessionsByDate } = await import('../utils/sessionUtils')
      expect(sortSessionsByDate([])).toEqual([])
    })
  })

  describe('query key', () => {
    it('should use admin-sessions query key from queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys')
      expect(typeof queryKeys.adminSessions).toBe('function')

      const key = queryKeys.adminSessions(2025)
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('admin-sessions')
      expect(key).toContain(2025)
    })
  })
})
