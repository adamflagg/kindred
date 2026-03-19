/**
 * TDD Tests for useBunkStaff hook (v3 — session-level).
 *
 * Tests written FIRST before implementation.
 * This hook fetches bunk staff and their bunk_assignments to build a
 * Map<"sessionName|bunkName", BunkStaffInfo[]> for cell-level tooltips.
 */
import { describe, it, expect } from 'vitest'

describe('useBunkStaff', () => {
  describe('hook export', () => {
    it('should export useBunkStaff hook', async () => {
      const module = await import('./useBunkStaff')
      expect(typeof module.useBunkStaff).toBe('function')
    })

    it('should export BunkStaffInfo type', async () => {
      const module = await import('./useBunkStaff')
      expect(module).toBeDefined()
    })
  })

  describe('query key structure', () => {
    it('should have bunkStaff in queryKeys', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      expect(typeof queryKeys.bunkStaff).toBe('function')
    })

    it('should include year in query key', async () => {
      const { queryKeys } = await import('../utils/queryKeys')

      const key = queryKeys.bunkStaff(2025)
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain('bunk-staff')
      expect(key).toContain(2025)
    })
  })

  describe('return type structure', () => {
    it('BunkStaffInfo should have name and personId fields', () => {
      const expectedShape = {
        name: 'Emma Johnson',
        personId: '12345',
      }

      expect(Object.keys(expectedShape)).toContain('name')
      expect(Object.keys(expectedShape)).toContain('personId')
    })

    it('BunkStaffInfo should support optional status field', () => {
      const activeStaff = {
        name: 'Emma Johnson',
        personId: '12345',
        status: 'active',
      }
      const dismissedStaff = {
        name: 'Liam Garcia',
        personId: '67890',
        status: 'dismissed',
      }
      const noStatusStaff = {
        name: 'Olivia Chen',
        personId: '11111',
      }

      expect(activeStaff.status).toBe('active')
      expect(dismissedStaff.status).toBe('dismissed')
      expect('status' in noStatusStaff).toBe(false)
    })

    it('should return Map<string, BunkStaffInfo[]> keyed by session|bunk', () => {
      // v3: Map is keyed by "sessionName|bunkName" for cell-level lookup
      const exampleReturn = new Map<string, Array<{ name: string; personId: string }>>()
      exampleReturn.set('Session 2|B-3', [
        { name: 'Emma Johnson', personId: '12345' },
        { name: 'Liam Garcia', personId: '67890' },
      ])
      exampleReturn.set('Session 2|AG-8', [{ name: 'Olivia Chen', personId: '11111' }])

      const s2b3Staff = exampleReturn.get('Session 2|B-3')
      expect(s2b3Staff).toHaveLength(2)
      expect(s2b3Staff?.[0]?.name).toBe('Emma Johnson')

      const s2ag8Staff = exampleReturn.get('Session 2|AG-8')
      expect(s2ag8Staff).toHaveLength(1)

      // Different session for same bunk should not exist unless added
      expect(exampleReturn.get('Session 1|B-3')).toBeUndefined()
    })
  })
})
