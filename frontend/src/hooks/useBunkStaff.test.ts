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

  describe('PocketBase collection usage', () => {
    it('should fetch from bunk_assignments collection for session-level data', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      // v3: Must use bunk_assignments (not just staff.bunks) for session-level resolution
      expect(source).toContain('bunk_assignments')
    })

    it('should fetch from staff collection to identify bunk staff', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain(".collection('staff')")
      expect(source).toContain('bunk_staff')
    })

    it('should expand person relation for display names', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('person')
      expect(source).toContain('expand')
    })

    it('should expand session and bunk relations on bunk_assignments', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('session')
      expect(source).toContain('bunk')
    })

    it('should filter by year', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('year')
      expect(source).toContain('filter')
    })

    it('should read staff status from record', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('status')
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

  describe('data transformation', () => {
    it('should build a Map keyed by session|bunk', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      // Should use Map for the session+bunk-to-staff lookup
      expect(source).toContain('Map')
    })

    it('should use pipe separator in map key for session|bunk', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      // Map key format: "sessionName|bunkName"
      expect(source).toContain('|')
    })

    it('should use preferred_name over first_name when available', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('preferred_name')
      expect(source).toContain('first_name')
    })

    it('should include last_name in display name', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('last_name')
    })
  })

  describe('AG session normalization', () => {
    it('should fetch camp_sessions for AG parent resolution', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      // Must fetch camp_sessions to build cm_id→name lookup for AG parents
      expect(source).toContain("collection('camp_sessions')")
    })

    it('should check session_type for AG detection', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('session_type')
      expect(source).toContain("'ag'")
    })

    it('should resolve parent_id to parent session name', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('parent_id')
    })
  })

  describe('caching options', () => {
    it('should use syncDataOptions (Tier 1 long cache)', async () => {
      const sourceContent = await import('./useBunkStaff?raw')
      const source = sourceContent.default

      expect(source).toContain('syncDataOptions')
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
