import { describe, it, expect } from 'vitest'
import {
  getFormattedSessionName,
  getSessionDisplayName,
  getParentSessionId,
  getSessionDisplayNameFromString,
  getSessionChartLabel,
  getSessionShorthand,
  getSessionShortName,
  shortenSessionName,
} from './sessionDisplay'
import type { Session } from '../types/app-types'

describe('sessionDisplay utilities', () => {
  // Cast helper for partial session mocks (only fields relevant to test)
  const s = (partial: Record<string, unknown>) => partial as Session

  // Mock sessions for testing parent relationships
  const mockAllSessions: Session[] = [
    s({
      id: 'main-2',
      name: 'Session 2',
      session_type: 'main',
      start_date: '2025-06-01',
      end_date: '2025-06-14',
      cm_id: 200,
      year: 2025,
    }),
    s({
      id: 'main-3',
      name: 'Session 3',
      session_type: 'main',
      start_date: '2025-06-15',
      end_date: '2025-06-28',
      cm_id: 300,
      year: 2025,
    }),
    s({
      id: 'ag-2',
      name: 'All-Gender Cabin-Session 2 (7th - 9th grades)',
      session_type: 'ag',
      parent_id: 200, // Points to Session 2
      start_date: '2025-06-01',
      end_date: '2025-06-14',
      cm_id: 201,
      year: 2025,
    }),
  ]

  describe('getSessionDisplayName', () => {
    it('should handle undefined session', () => {
      expect(getSessionDisplayName(undefined)).toBe('Unknown Session')
    })

    it('should use parent session name for AG sessions when allSessions provided', () => {
      const agSession = mockAllSessions[2]
      if (!agSession) throw new Error('AG session not found')

      // With allSessions, should return parent's display name
      expect(getSessionDisplayName(agSession, mockAllSessions)).toBe('Session 2')
    })

    it('should fallback to original name when allSessions not provided', () => {
      const agSession = s({
        id: '1',
        name: 'All-Gender Cabin-Session 2',
        session_type: 'ag',
        parent_id: 200,
      })
      // Without allSessions, should return original name
      expect(getSessionDisplayName(agSession)).toBe('All-Gender Cabin-Session 2')
    })

    it('should handle embedded sessions', () => {
      const embeddedSession = s({
        id: '2',
        name: 'Session 2a',
        session_type: 'embedded',
      })
      expect(getSessionDisplayName(embeddedSession)).toBe('Session 2a')
    })

    it('should handle main sessions', () => {
      const mainSession = s({
        id: '3',
        name: 'Session 2',
        session_type: 'main',
      })
      expect(getSessionDisplayName(mainSession)).toBe('Session 2')
    })

    it('should handle taste-named sessions', () => {
      const tasteSession = s({
        id: '4',
        name: 'Taste of Camp',
        session_type: 'other',
      })
      expect(getSessionDisplayName(tasteSession)).toBe('Taste of Camp')
    })

    it('should fallback to original name for unknown types', () => {
      const otherSession = s({
        id: '5',
        name: 'Family Camp 1',
        session_type: 'family',
      })
      expect(getSessionDisplayName(otherSession)).toBe('Family Camp 1')
    })
  })

  describe('getParentSessionId', () => {
    it('should return parent session ID for AG session with parent_id', () => {
      const agSession = mockAllSessions[2]
      if (!agSession) {
        throw new Error('AG session not found in test data')
      }
      // AG session has parent_id pointing to Session 2 (cm_id: 200)
      expect(getParentSessionId(agSession, mockAllSessions)).toBe(200)
    })

    it('should return original ID for non-AG sessions', () => {
      const mainSession = mockAllSessions[0]
      if (!mainSession) {
        throw new Error('Main session not found in test data')
      }
      expect(getParentSessionId(mainSession, mockAllSessions)).toBe(200)
    })

    it('should return original ID if no parent found', () => {
      const agSession = s({
        id: 'ag-99',
        name: 'All-Gender Cabin-Session 99',
        session_type: 'ag',
        parent_id: 9999, // No matching parent in allSessions
        cm_id: 123,
      })
      expect(getParentSessionId(agSession, mockAllSessions)).toBe(123)
    })
  })

  describe('getSessionDisplayNameFromString', () => {
    it('should handle empty session name', () => {
      expect(getSessionDisplayNameFromString('')).toBe('Unknown Session')
      expect(getSessionDisplayNameFromString('', 'ag')).toBe('Unknown Session')
    })

    it('should transform AG sessions by type', () => {
      expect(getSessionDisplayNameFromString('Some AG Session', 'ag')).toBe('Some AG Session')
      expect(getSessionDisplayNameFromString('AG Session 2', 'ag')).toBe('Session 2')
    })

    it('should transform AG sessions by name pattern', () => {
      expect(getSessionDisplayNameFromString('All-Gender Cabin-Session 2')).toBe('Session 2')
      expect(getSessionDisplayNameFromString('Session 3 All-Gender')).toBe('Session 3')
      expect(getSessionDisplayNameFromString('ag session 3')).toBe('Session 3')
    })

    it('should return original name if no transformation needed', () => {
      expect(getSessionDisplayNameFromString('Session 2')).toBe('Session 2')
      expect(getSessionDisplayNameFromString('Taste of Camp')).toBe('Taste of Camp')
      expect(getSessionDisplayNameFromString('Family Camp 1')).toBe('Family Camp 1')
    })
  })

  describe('getFormattedSessionName', () => {
    it('should return "Unknown Session" for undefined session', () => {
      expect(getFormattedSessionName(undefined)).toBe('Unknown Session')
    })

    it('should return "Unknown Session" for session without name', () => {
      expect(getFormattedSessionName(s({ id: '1', name: '', session_type: 'main' }))).toBe(
        'Unknown Session'
      )
    })

    it('should return parent name for AG session when allSessions provided', () => {
      const agSession = s({
        id: 'ag-2',
        name: 'All-Gender Cabin-Session 2',
        session_type: 'ag',
        parent_id: 200,
        cm_id: 201,
      })
      const allSessions: Session[] = [
        s({ id: 'main-2', name: 'Session 2', session_type: 'main', cm_id: 200 }),
      ]
      expect(getFormattedSessionName(agSession, allSessions)).toBe('Session 2')
    })

    it('should return original name for AG session when parent not found', () => {
      const agSession = s({
        id: 'ag-99',
        name: 'All-Gender Cabin-Session 99',
        session_type: 'ag',
        parent_id: 9999,
        cm_id: 201,
      })
      expect(getFormattedSessionName(agSession, [])).toBe('All-Gender Cabin-Session 99')
    })

    it('should return original name for non-AG sessions', () => {
      const mainSession = s({
        id: 'main-2',
        name: 'Session 2',
        session_type: 'main',
        cm_id: 200,
      })
      expect(getFormattedSessionName(mainSession)).toBe('Session 2')
    })
  })

  describe('getSessionChartLabel', () => {
    it('should return "Unknown" for empty session name', () => {
      expect(getSessionChartLabel('')).toBe('Unknown')
    })

    it('should return taste session name as-is', () => {
      expect(getSessionChartLabel('Taste of Camp')).toBe('Taste of Camp')
      expect(getSessionChartLabel('Taste of Camp 2', 'taste')).toBe('Taste of Camp 2')
      expect(getSessionChartLabel('Taste of Camp 2025', 'taste')).toBe('Taste of Camp 2025')
    })

    it('should abbreviate AG sessions and preserve grade ranges', () => {
      expect(getSessionChartLabel('All-Gender Cabin-Session 2', 'ag')).toBe('All-Gender 2')
      expect(getSessionChartLabel('All-Gender Cabin-Session 2 (Grades 6-8)', 'ag')).toBe(
        'All-Gender 2 (6-8)'
      )
      expect(getSessionChartLabel('All-Gender Cabin-Session 3 (Grades 3-5) 2025')).toBe(
        'All-Gender 3 (3-5)'
      )
      expect(getSessionChartLabel('AG Session 4', 'ag')).toBe('All-Gender 4')
    })

    it('should preserve main session format', () => {
      expect(getSessionChartLabel('Session 2')).toBe('Session 2')
      expect(getSessionChartLabel('Session 3', 'main')).toBe('Session 3')
    })

    it('should preserve embedded session format', () => {
      expect(getSessionChartLabel('Session 2a', 'embedded')).toBe('Session 2a')
      expect(getSessionChartLabel('Session 3b')).toBe('Session 3b')
    })

    it('should truncate very long names without grade ranges', () => {
      expect(getSessionChartLabel('Some Very Long Session Name That Goes On Forever')).toBe(
        'Some Very Long Session...'
      )
    })
  })

  describe('getSessionShorthand', () => {
    it('should return empty string for empty session name', () => {
      expect(getSessionShorthand('')).toBe('')
    })

    it('should return "Taste" for Taste of Camp sessions', () => {
      expect(getSessionShorthand('Taste of Camp')).toBe('Taste')
      // 4-digit year suffixes must not be mistaken for cohort numbers.
      expect(getSessionShorthand('Taste of Camp 2025', 'taste')).toBe('Taste')
      // Split cohorts must be distinguishable on solver-debug source labels.
      expect(getSessionShorthand('Taste of Camp 1')).toBe('Taste 1')
      expect(getSessionShorthand('Taste of Camp 2')).toBe('Taste 2')
      // Two-digit cohorts supported in case the camp scales beyond 9.
      expect(getSessionShorthand('Taste of Camp 10')).toBe('Taste 10')
    })

    it('should extract session number from "Session N" format', () => {
      expect(getSessionShorthand('Session 2')).toBe('2')
      expect(getSessionShorthand('Session 3')).toBe('3')
      expect(getSessionShorthand('Session 2a')).toBe('2a')
      expect(getSessionShorthand('Session 3b')).toBe('3b')
    })

    it('should extract number from AG sessions', () => {
      expect(getSessionShorthand('AG Session 2', 'ag')).toBe('2')
      expect(getSessionShorthand('All-Gender Cabin-Session 3')).toBe('3')
      expect(getSessionShorthand('Session 2 All-Gender')).toBe('2')
    })

    it('should fallback to number extraction', () => {
      expect(getSessionShorthand('Camp Week 4')).toBe('4')
      expect(getSessionShorthand('Week 2a Program')).toBe('2a')
    })

    it('should return first word as last resort', () => {
      expect(getSessionShorthand('Family Camp')).toBe('Family')
      expect(getSessionShorthand('Special Event')).toBe('Special')
    })

    it('should handle AG session type parameter', () => {
      expect(getSessionShorthand('Some AG Session 2', 'ag')).toBe('2')
    })
  })

  describe('getSessionChartLabel with date lookup', () => {
    it('should return taste session name as-is, ignoring date lookup', () => {
      const dateLookup = {
        'Taste of Camp 1': '2026-06-01',
        'Taste of Camp 2': '2026-06-08',
      }

      // Date lookup is ignored for Taste sessions - just return name as-is
      expect(getSessionChartLabel('Taste of Camp 1', undefined, dateLookup)).toBe('Taste of Camp 1')
      expect(getSessionChartLabel('Taste of Camp 2', undefined, dateLookup)).toBe('Taste of Camp 2')
    })

    it('should not transform taste session names with date lookup', () => {
      const dateLookup = {
        'Taste of Camp': '2026-06-15',
      }

      expect(getSessionChartLabel('Taste of Camp', 'taste', dateLookup)).toBe('Taste of Camp')
    })

    it('should not append date to non-Taste sessions', () => {
      const dateLookup = {
        'Session 2': '2026-06-15',
        'Session 3': '2026-07-01',
      }

      expect(getSessionChartLabel('Session 2', 'main', dateLookup)).toBe('Session 2')
      expect(getSessionChartLabel('Session 3', 'main', dateLookup)).toBe('Session 3')
    })

    it('should work without date lookup (backward compatibility)', () => {
      expect(getSessionChartLabel('Taste of Camp')).toBe('Taste of Camp')
      expect(getSessionChartLabel('Taste of Camp 2')).toBe('Taste of Camp 2')
      expect(getSessionChartLabel('Session 2')).toBe('Session 2')
    })
  })

  describe('shortenSessionName', () => {
    it('should return non-AG session names unchanged', () => {
      expect(shortenSessionName('Session 2')).toBe('Session 2')
      expect(shortenSessionName('Session 4')).toBe('Session 4')
      expect(shortenSessionName('Taste of Camp')).toBe('Taste of Camp')
    })

    it('should shorten current-format AG names with grade ranges', () => {
      expect(shortenSessionName('All-Gender Cabin-Session 2 (7th - 9th grades)')).toBe('AG 2 (7-9)')
      expect(shortenSessionName('All-Gender Cabin-Session 4 (4th - 6th grades)')).toBe('AG 4 (4-6)')
    })

    it('should shorten older-format AG names with grade ranges', () => {
      expect(shortenSessionName('Session 4 (All-Gender Cabin)-6th & 7th grades')).toBe('AG 4 (6-7)')
    })

    it('should shorten AG names without grade ranges', () => {
      expect(shortenSessionName('Session B (All-Gender Cabins)')).toBe('AG B')
    })

    it('should handle AG prefix in name', () => {
      expect(shortenSessionName('AG-Session 3 (4th - 6th grades)')).toBe('AG 3 (4-6)')
    })
  })

  describe('getSessionShortName', () => {
    it('should return null for undefined session', () => {
      expect(getSessionShortName(undefined)).toBe(null)
    })

    it('should return null for falsy session', () => {
      expect(getSessionShortName(null as any)).toBe(null)
    })

    it('should return raw name for quest sessions', () => {
      expect(getSessionShortName(s({ session_type: 'quest', name: 'Teen Adventure Quests' }))).toBe(
        'Teen Adventure Quests'
      )
    })

    it('should fallback to "Quest" for quest session without name', () => {
      expect(getSessionShortName(s({ session_type: 'quest' }))).toBe('Quest')
    })

    it('should shorten AG session names', () => {
      expect(
        getSessionShortName(
          s({ session_type: 'ag', name: 'All-Gender Cabin-Session 2 (7th & 8th grades)' })
        )
      ).toBe('AG 2 (7-8)')
      expect(
        getSessionShortName(
          s({ session_type: 'ag', name: 'All-Gender Cabin-Session 4 (4th - 6th grades)' })
        )
      ).toBe('AG 4 (4-6)')
    })

    it('should shorten AG sessions without grade ranges', () => {
      expect(
        getSessionShortName(s({ session_type: 'ag', name: 'All-Gender Cabin-Session 2' }))
      ).toBe('AG 2')
    })

    it('should fallback to "AG" for AG session without name', () => {
      expect(getSessionShortName(s({ session_type: 'ag' }))).toBe('AG')
    })

    it('should return raw name for embedded sessions (Session 2a)', () => {
      expect(getSessionShortName(s({ session_type: 'embedded', name: 'Session 2a' }))).toBe(
        'Session 2a'
      )
    })

    it('should return raw name for embedded Taste of Camp 2 (no suffix stripping)', () => {
      expect(getSessionShortName(s({ session_type: 'embedded', name: 'Taste of Camp 2' }))).toBe(
        'Taste of Camp 2'
      )
    })

    it('should return raw name for main sessions', () => {
      expect(getSessionShortName(s({ session_type: 'main', name: 'Session 2' }))).toBe('Session 2')
    })

    it('should return raw name for main Taste of Camp 1 (no suffix stripping)', () => {
      expect(getSessionShortName(s({ session_type: 'main', name: 'Taste of Camp 1' }))).toBe(
        'Taste of Camp 1'
      )
    })

    it('should return raw name even when it contains digits and parens', () => {
      // Real-world AG names are shortened, but other types keep their raw text.
      expect(
        getSessionShortName(s({ session_type: 'main', name: 'Session 2 (Grades 4-6) June 1-14' }))
      ).toBe('Session 2 (Grades 4-6) June 1-14')
    })

    it('should preserve case for non-AG sessions', () => {
      expect(getSessionShortName(s({ session_type: 'main', name: 'TASTE OF CAMP 2' }))).toBe(
        'TASTE OF CAMP 2'
      )
    })

    it('should return name as-is for family/other unknown session types', () => {
      expect(getSessionShortName(s({ session_type: 'family', name: 'Family Camp 1' }))).toBe(
        'Family Camp 1'
      )
    })

    it('should return null if no name provided and no fallback applies', () => {
      expect(getSessionShortName(s({ session_type: 'main' }))).toBe(null)
      expect(getSessionShortName(s({ session_type: 'embedded' }))).toBe(null)
      expect(getSessionShortName(s({ session_type: 'unknown' }))).toBe(null)
    })

    it('should not strip suffix for taste-named sessions of any type', () => {
      // Regression: previously "Taste of Camp 2" was collapsed to "Taste of Camp"
      // by a name-based check. Raw name is the desired behavior — the suffix
      // is meaningful (1 vs 2 are different sessions).
      expect(getSessionShortName(s({ name: 'Taste of Camp 1' }))).toBe('Taste of Camp 1')
      expect(getSessionShortName(s({ name: 'Taste of Camp 2' }))).toBe('Taste of Camp 2')
      expect(getSessionShortName(s({ session_type: 'main', name: 'Taste of Camp 1' }))).toBe(
        'Taste of Camp 1'
      )
      expect(getSessionShortName(s({ session_type: 'embedded', name: 'Taste of Camp 2' }))).toBe(
        'Taste of Camp 2'
      )
    })
  })
})
