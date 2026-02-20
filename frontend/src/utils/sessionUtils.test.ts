/**
 * Tests for session URL utilities
 */
import { describe, it, expect } from 'vitest'
import {
  sessionNameToUrl,
  urlToSessionName,
  isKnownSessionUrl,
  isNumericSessionId,
  findSessionByUrlSegment,
  isValidTab,
  VALID_TABS,
} from './sessionUtils'
import type { Session } from '../types/app-types'

describe('sessionNameToUrl', () => {
  it('should convert known session names to URL segments', () => {
    expect(sessionNameToUrl('Taste of Camp')).toBe('taste')
    expect(sessionNameToUrl('Session 1')).toBe('1')
    expect(sessionNameToUrl('Session 2')).toBe('2')
    expect(sessionNameToUrl('Session 2a')).toBe('2a')
    expect(sessionNameToUrl('Session 2b')).toBe('2b')
    expect(sessionNameToUrl('Session 3')).toBe('3')
    expect(sessionNameToUrl('Session 3a')).toBe('3a')
    expect(sessionNameToUrl('Session 4')).toBe('4')
  })

  it('should convert unknown session names to URL-friendly format', () => {
    expect(sessionNameToUrl('All-Gender Session')).toBe('all-gender-session')
    expect(sessionNameToUrl('Special Event!')).toBe('special-event')
    expect(sessionNameToUrl('Multiple   Spaces')).toBe('multiple-spaces')
  })

  it('should handle empty string', () => {
    expect(sessionNameToUrl('')).toBe('')
  })
})

describe('urlToSessionName', () => {
  it('should convert known URL segments to session names', () => {
    expect(urlToSessionName('taste')).toBe('Taste of Camp')
    expect(urlToSessionName('1')).toBe('Session 1')
    expect(urlToSessionName('2')).toBe('Session 2')
    expect(urlToSessionName('2a')).toBe('Session 2a')
    expect(urlToSessionName('3')).toBe('Session 3')
    expect(urlToSessionName('4')).toBe('Session 4')
  })

  it('should return null for unknown URL segments', () => {
    expect(urlToSessionName('unknown')).toBe(null)
    expect(urlToSessionName('special-event')).toBe(null)
  })
})

describe('isKnownSessionUrl', () => {
  it('should return true for known URL segments', () => {
    expect(isKnownSessionUrl('taste')).toBe(true)
    expect(isKnownSessionUrl('1')).toBe(true)
    expect(isKnownSessionUrl('2a')).toBe(true)
  })

  it('should return false for unknown URL segments', () => {
    expect(isKnownSessionUrl('unknown')).toBe(false)
    expect(isKnownSessionUrl('5')).toBe(false)
  })
})

describe('isNumericSessionId', () => {
  it('should return true for numeric strings', () => {
    expect(isNumericSessionId('123')).toBe(true)
    expect(isNumericSessionId('1234567')).toBe(true)
    expect(isNumericSessionId('0')).toBe(true)
  })

  it('should return false for non-numeric strings', () => {
    expect(isNumericSessionId('2a')).toBe(false)
    expect(isNumericSessionId('taste')).toBe(false)
    expect(isNumericSessionId('')).toBe(false)
    expect(isNumericSessionId('12.34')).toBe(false)
  })
})

describe('findSessionByUrlSegment', () => {
  // Cast helper for partial session mocks
  const s = (partial: Record<string, unknown>) => partial as Session

  const mockSessions: Session[] = [
    s({
      id: 's1',
      name: 'Taste of Camp',
      cm_id: 1001,
      start_date: '2025-06-01',
      end_date: '2025-06-07',
      session_type: 'main',
      year: 2025,
    }),
    s({
      id: 's2',
      name: 'Session 2',
      cm_id: 1002,
      start_date: '2025-06-15',
      end_date: '2025-07-01',
      session_type: 'main',
      year: 2025,
    }),
    s({
      id: 's3',
      name: 'All-Gender Cabin',
      cm_id: 1003,
      start_date: '2025-06-15',
      end_date: '2025-07-01',
      session_type: 'ag',
      year: 2025,
    }),
  ]

  it('should find session by known URL segment', () => {
    const result = findSessionByUrlSegment(mockSessions, 'taste')
    expect(result?.name).toBe('Taste of Camp')
  })

  it('should find session by numeric CM ID', () => {
    const result = findSessionByUrlSegment(mockSessions, '1002')
    expect(result?.name).toBe('Session 2')
  })

  it('should find session by URL-friendly name', () => {
    const result = findSessionByUrlSegment(mockSessions, 'all-gender-cabin')
    expect(result?.name).toBe('All-Gender Cabin')
  })

  it('should return null for non-existent session', () => {
    const result = findSessionByUrlSegment(mockSessions, 'nonexistent')
    expect(result).toBe(null)
  })

  it('should return null for empty sessions array', () => {
    const result = findSessionByUrlSegment([], 'taste')
    expect(result).toBe(null)
  })
})

describe('isValidTab', () => {
  it('should return true for valid tabs', () => {
    for (const tab of VALID_TABS) {
      expect(isValidTab(tab)).toBe(true)
    }
  })

  it('should return false for invalid tabs', () => {
    expect(isValidTab('invalid')).toBe(false)
    expect(isValidTab('settings')).toBe(false)
    expect(isValidTab('')).toBe(false)
  })
})

describe('VALID_TABS', () => {
  it('should contain expected tabs', () => {
    expect(VALID_TABS).toContain('bunks')
    expect(VALID_TABS).toContain('campers')
    expect(VALID_TABS).toContain('requests')
    expect(VALID_TABS).toContain('review')
    expect(VALID_TABS).toContain('friends')
    expect(VALID_TABS).toContain('logs')
  })
})

// Import sorting functions for testing
import { parseSessionName, sortSessionDataByName } from './sessionUtils'

describe('parseSessionName', () => {
  it('should parse main session names correctly', () => {
    expect(parseSessionName('Session 1')).toEqual([1, ''])
    expect(parseSessionName('Session 2')).toEqual([2, ''])
    expect(parseSessionName('Session 3')).toEqual([3, ''])
    expect(parseSessionName('Session 4')).toEqual([4, ''])
  })

  it('should parse embedded session names with suffixes', () => {
    expect(parseSessionName('Session 2a')).toEqual([2, 'a'])
    expect(parseSessionName('Session 2b')).toEqual([2, 'b'])
    expect(parseSessionName('Session 3a')).toEqual([3, 'a'])
  })

  it('should handle "Taste of Camp" as session 0', () => {
    expect(parseSessionName('Taste of Camp')).toEqual([0, 'taste of camp'])
  })

  it('should handle case insensitivity', () => {
    expect(parseSessionName('SESSION 2')).toEqual([2, ''])
    expect(parseSessionName('session 3A')).toEqual([3, 'a'])
  })

  it('should handle unknown session names', () => {
    expect(parseSessionName('Unknown Session')).toEqual([0, 'unknown session'])
    expect(parseSessionName('')).toEqual([0, ''])
  })
})

describe('sortSessionDataByName', () => {
  it('should sort session data objects by session_name field', () => {
    const data = [
      { session_name: 'Session 4', count: 100 },
      { session_name: 'Session 2', count: 150 },
      { session_name: 'Session 3a', count: 50 },
      { session_name: 'Taste of Camp', count: 30 },
      { session_name: 'Session 2b', count: 40 },
      { session_name: 'Session 3', count: 120 },
      { session_name: 'Session 2a', count: 45 },
    ]

    const sorted = sortSessionDataByName(data)

    expect(sorted.map((s) => s.session_name)).toEqual([
      'Taste of Camp',
      'Session 2',
      'Session 2a',
      'Session 2b',
      'Session 3',
      'Session 3a',
      'Session 4',
    ])
  })

  it('should preserve other fields', () => {
    const data = [
      { session_name: 'Session 4', count: 100, capacity: 120 },
      { session_name: 'Session 2', count: 150, capacity: 160 },
    ]

    const sorted = sortSessionDataByName(data)

    expect(sorted[0]).toEqual({
      session_name: 'Session 2',
      count: 150,
      capacity: 160,
    })
    expect(sorted[1]).toEqual({
      session_name: 'Session 4',
      count: 100,
      capacity: 120,
    })
  })

  it('should handle empty array', () => {
    expect(sortSessionDataByName([])).toEqual([])
  })

  it('should not mutate original array', () => {
    const data = [
      { session_name: 'Session 4', count: 100 },
      { session_name: 'Session 2', count: 150 },
    ]
    const original = [...data]
    sortSessionDataByName(data)
    expect(data).toEqual(original)
  })
})

// Import date-aware sorting functions for testing
import {
  buildSessionDateLookup,
  sortSessionDataByDate,
  sortPriorSessionDataByDate,
  type SessionDateLookup,
} from './sessionUtils'

describe('buildSessionDateLookup', () => {
  it('should build a lookup map from session name to start_date', () => {
    const sessions = [
      { name: 'Taste of Camp 1', start_date: '2026-06-01' },
      { name: 'Taste of Camp 2', start_date: '2026-06-08' },
      { name: 'Session 2', start_date: '2026-06-15' },
    ]

    const lookup = buildSessionDateLookup(sessions)

    expect(lookup['Taste of Camp 1']).toBe('2026-06-01')
    expect(lookup['Taste of Camp 2']).toBe('2026-06-08')
    expect(lookup['Session 2']).toBe('2026-06-15')
  })

  it('should handle empty array', () => {
    const lookup = buildSessionDateLookup([])
    expect(lookup).toEqual({})
  })

  it('should handle sessions with duplicate names (last one wins)', () => {
    const sessions = [
      { name: 'Session 2', start_date: '2026-06-01' },
      { name: 'Session 2', start_date: '2026-06-15' },
    ]

    const lookup = buildSessionDateLookup(sessions)

    expect(lookup['Session 2']).toBe('2026-06-15')
  })
})

describe('sortSessionDataByDate', () => {
  it('should sort sessions by date when dates are available', () => {
    const data = [
      { session_name: 'Session 2', count: 100 },
      { session_name: 'Taste of Camp 2', count: 30 },
      { session_name: 'Taste of Camp 1', count: 25 },
      { session_name: 'Session 3', count: 120 },
    ]

    const dateLookup: SessionDateLookup = {
      'Taste of Camp 1': '2026-06-01',
      'Taste of Camp 2': '2026-06-08',
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    }

    const sorted = sortSessionDataByDate(data, dateLookup)

    expect(sorted.map((s) => s.session_name)).toEqual([
      'Taste of Camp 1',
      'Taste of Camp 2',
      'Session 2',
      'Session 3',
    ])
  })

  it('should use name-based sorting as tiebreaker for same date', () => {
    const data = [
      { session_name: 'Session 2b', count: 40 },
      { session_name: 'Session 2', count: 100 },
      { session_name: 'Session 2a', count: 50 },
    ]

    // All have the same date
    const dateLookup: SessionDateLookup = {
      'Session 2': '2026-06-15',
      'Session 2a': '2026-06-15',
      'Session 2b': '2026-06-15',
    }

    const sorted = sortSessionDataByDate(data, dateLookup)

    expect(sorted.map((s) => s.session_name)).toEqual(['Session 2', 'Session 2a', 'Session 2b'])
  })

  it('should handle sessions not in date lookup by falling back to name sort', () => {
    const data = [
      { session_name: 'Session 2', count: 100 },
      { session_name: 'Unknown Session', count: 10 },
      { session_name: 'Session 3', count: 120 },
    ]

    const dateLookup: SessionDateLookup = {
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
      // 'Unknown Session' not in lookup
    }

    const sorted = sortSessionDataByDate(data, dateLookup)

    // Unknown Session should sort based on name (number 0), coming first
    expect(sorted.map((s) => s.session_name)).toEqual(['Unknown Session', 'Session 2', 'Session 3'])
  })

  it('should handle empty array', () => {
    expect(sortSessionDataByDate([], {})).toEqual([])
  })

  it('should not mutate original array', () => {
    const data = [
      { session_name: 'Session 3', count: 120 },
      { session_name: 'Session 2', count: 100 },
    ]
    const original = [...data]
    const dateLookup: SessionDateLookup = {
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    }

    sortSessionDataByDate(data, dateLookup)

    expect(data).toEqual(original)
  })

  it('should preserve other fields', () => {
    const data = [
      { session_name: 'Session 3', count: 120, utilization: 90 },
      { session_name: 'Session 2', count: 100, utilization: 85 },
    ]

    const dateLookup: SessionDateLookup = {
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    }

    const sorted = sortSessionDataByDate(data, dateLookup)

    expect(sorted[0]).toEqual({
      session_name: 'Session 2',
      count: 100,
      utilization: 85,
    })
    expect(sorted[1]).toEqual({
      session_name: 'Session 3',
      count: 120,
      utilization: 90,
    })
  })

  it('should correctly differentiate multiple Taste of Camp sessions by date', () => {
    const data = [
      { session_name: 'Taste of Camp', count: 30 },
      { session_name: 'Taste of Camp', count: 25 },
      { session_name: 'Session 2', count: 100 },
    ]

    // When there are duplicate session names, the lookup won't help
    // This tests that we handle this gracefully (stable sort behavior)
    const dateLookup: SessionDateLookup = {
      'Taste of Camp': '2026-06-01', // Only one date for "Taste of Camp"
      'Session 2': '2026-06-15',
    }

    const sorted = sortSessionDataByDate(data, dateLookup)

    // Taste of Camp entries should come first (earlier date), Session 2 last
    expect(sorted[2]!.session_name).toBe('Session 2')
  })
})

describe('sortPriorSessionDataByDate', () => {
  it('should sort prior session data by date', () => {
    const data = [
      {
        prior_session: 'Session 3',
        base_count: 80,
        returned_count: 64,
        retention_rate: 0.8,
      },
      {
        prior_session: 'Taste of Camp 1',
        base_count: 30,
        returned_count: 24,
        retention_rate: 0.8,
      },
      {
        prior_session: 'Session 2',
        base_count: 100,
        returned_count: 70,
        retention_rate: 0.7,
      },
    ]

    const dateLookup: SessionDateLookup = {
      'Taste of Camp 1': '2026-06-01',
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    }

    const sorted = sortPriorSessionDataByDate(data, dateLookup)

    expect(sorted.map((s) => s.prior_session)).toEqual([
      'Taste of Camp 1',
      'Session 2',
      'Session 3',
    ])
  })

  it('should handle empty array', () => {
    expect(sortPriorSessionDataByDate([], {})).toEqual([])
  })

  it('should not mutate original array', () => {
    const data = [
      {
        prior_session: 'Session 3',
        base_count: 80,
        returned_count: 64,
        retention_rate: 0.8,
      },
      {
        prior_session: 'Session 2',
        base_count: 100,
        returned_count: 70,
        retention_rate: 0.7,
      },
    ]
    const original = [...data]
    const dateLookup: SessionDateLookup = {
      'Session 2': '2026-06-15',
      'Session 3': '2026-07-01',
    }

    sortPriorSessionDataByDate(data, dateLookup)

    expect(data).toEqual(original)
  })
})

// Import camp-then-quest sorting functions for testing
import {
  sortSessionsCampThenQuest,
  buildSessionTypeLookup,
  compareByDateCampThenQuest,
} from './sessionUtils'

describe('sortSessionsCampThenQuest', () => {
  it('should sort camp sessions before quest sessions', () => {
    const sessions = [
      { name: 'Teen Adventure Quest', session_type: 'quest' as const, start_date: '2026-06-10' },
      { name: 'Session 2', session_type: 'main' as const, start_date: '2026-07-01' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-06-15' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)

    expect(sorted.map((s) => s.name)).toEqual(['Session 1', 'Session 2', 'Teen Adventure Quest'])
  })

  it('should sort camp sessions chronologically by start_date', () => {
    const sessions = [
      { name: 'Session 3', session_type: 'main' as const, start_date: '2026-08-01' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-06-15' },
      { name: 'Session 2a', session_type: 'embedded' as const, start_date: '2026-07-01' },
      { name: 'Session 2', session_type: 'main' as const, start_date: '2026-07-01' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)

    expect(sorted.map((s) => s.name)).toEqual(['Session 1', 'Session 2', 'Session 2a', 'Session 3'])
  })

  it('should sort quest sessions chronologically among themselves', () => {
    const sessions = [
      { name: 'Quest B', session_type: 'quest' as const, start_date: '2026-08-01' },
      { name: 'Quest A', session_type: 'quest' as const, start_date: '2026-06-15' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-07-01' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)

    expect(sorted.map((s) => s.name)).toEqual(['Session 1', 'Quest A', 'Quest B'])
  })

  it('should handle empty array', () => {
    expect(sortSessionsCampThenQuest([])).toEqual([])
  })

  it('should handle only camp sessions', () => {
    const sessions = [
      { name: 'Session 2', session_type: 'main' as const, start_date: '2026-07-01' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-06-15' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)
    expect(sorted.map((s) => s.name)).toEqual(['Session 1', 'Session 2'])
  })

  it('should handle only quest sessions', () => {
    const sessions = [
      { name: 'Quest B', session_type: 'quest' as const, start_date: '2026-08-01' },
      { name: 'Quest A', session_type: 'quest' as const, start_date: '2026-06-15' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)
    expect(sorted.map((s) => s.name)).toEqual(['Quest A', 'Quest B'])
  })

  it('should not mutate original array', () => {
    const sessions = [
      { name: 'Quest A', session_type: 'quest' as const, start_date: '2026-06-15' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-07-01' },
    ]
    const original = [...sessions]

    sortSessionsCampThenQuest(sessions)

    expect(sessions).toEqual(original)
  })

  it('should treat ag sessions as camp sessions', () => {
    const sessions = [
      { name: 'Quest A', session_type: 'quest' as const, start_date: '2026-06-10' },
      { name: 'AG Session', session_type: 'ag' as const, start_date: '2026-07-01' },
      { name: 'Session 1', session_type: 'main' as const, start_date: '2026-06-15' },
    ]

    const sorted = sortSessionsCampThenQuest(sessions)

    expect(sorted.map((s) => s.name)).toEqual(['Session 1', 'AG Session', 'Quest A'])
  })
})

describe('buildSessionTypeLookup', () => {
  it('should build a lookup map from session name to session_type', () => {
    const sessions = [
      { name: 'Session 1', session_type: 'main' as const },
      { name: 'Session 2a', session_type: 'embedded' as const },
      { name: 'Teen Quest', session_type: 'quest' as const },
    ]

    const lookup = buildSessionTypeLookup(sessions)

    expect(lookup['Session 1']).toBe('main')
    expect(lookup['Session 2a']).toBe('embedded')
    expect(lookup['Teen Quest']).toBe('quest')
  })

  it('should handle empty array', () => {
    expect(buildSessionTypeLookup([])).toEqual({})
  })
})

describe('compareByDateCampThenQuest', () => {
  const dateLookup: SessionDateLookup = {
    'Session 1': '2026-06-15',
    'Session 2': '2026-07-01',
    'Session 2a': '2026-07-01',
    'Teen Quest': '2026-06-10',
    'Quest B': '2026-08-01',
  }

  const typeLookup: Record<string, string> = {
    'Session 1': 'main',
    'Session 2': 'main',
    'Session 2a': 'embedded',
    'Teen Quest': 'quest',
    'Quest B': 'quest',
  }

  it('should sort camp sessions before quest sessions', () => {
    const result = compareByDateCampThenQuest('Session 1', 'Teen Quest', dateLookup, typeLookup)
    expect(result).toBeLessThan(0) // camp before quest
  })

  it('should sort quest sessions after camp sessions', () => {
    const result = compareByDateCampThenQuest('Teen Quest', 'Session 1', dateLookup, typeLookup)
    expect(result).toBeGreaterThan(0) // quest after camp
  })

  it('should sort camp sessions among themselves by date', () => {
    const result = compareByDateCampThenQuest('Session 2', 'Session 1', dateLookup, typeLookup)
    expect(result).toBeGreaterThan(0) // Session 2 (Jul) after Session 1 (Jun)
  })

  it('should sort quest sessions among themselves by date', () => {
    const result = compareByDateCampThenQuest('Quest B', 'Teen Quest', dateLookup, typeLookup)
    expect(result).toBeGreaterThan(0) // Quest B (Aug) after Teen Quest (Jun)
  })

  it('should use name-based fallback for same date within same group', () => {
    const result = compareByDateCampThenQuest('Session 2', 'Session 2a', dateLookup, typeLookup)
    // Both have same date (2026-07-01), name-based tiebreaker should sort Session 2 before 2a
    expect(result).toBeLessThan(0)
  })

  it('should handle sessions not in type lookup by treating as camp sessions', () => {
    const result = compareByDateCampThenQuest('Unknown', 'Teen Quest', dateLookup, typeLookup)
    // Unknown defaults to non-quest (camp), so should come before quest
    expect(result).toBeLessThan(0)
  })

  it('should return 0 for identical sessions', () => {
    const result = compareByDateCampThenQuest('Session 1', 'Session 1', dateLookup, typeLookup)
    expect(result).toBe(0)
  })
})

// Import sortSessionDataByCampThenQuest for testing
import { sortSessionDataByCampThenQuest, type SessionTypeLookup } from './sessionUtils'

describe('sortSessionDataByCampThenQuest', () => {
  const dateLookup: SessionDateLookup = {
    'Session 1': '2026-06-15',
    'Session 2': '2026-07-01',
    'Session 2a': '2026-07-01',
    'Session 3': '2026-08-01',
    'Teen Quest': '2026-06-10',
    'Quest B': '2026-08-15',
  }

  const typeLookup: SessionTypeLookup = {
    'Session 1': 'main',
    'Session 2': 'main',
    'Session 2a': 'embedded',
    'Session 3': 'main',
    'Teen Quest': 'quest',
    'Quest B': 'quest',
  }

  it('should sort camp sessions before quest sessions', () => {
    const data = [
      { session_name: 'Teen Quest', count: 20 },
      { session_name: 'Session 2', count: 100 },
      { session_name: 'Session 1', count: 80 },
      { session_name: 'Quest B', count: 15 },
      { session_name: 'Session 2a', count: 40 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    // Camp sessions first (chronological), then quest sessions (chronological)
    expect(sorted.map((s) => s.session_name)).toEqual([
      'Session 1',
      'Session 2',
      'Session 2a',
      'Teen Quest',
      'Quest B',
    ])
  })

  it('should sort camp sessions chronologically within their group', () => {
    const data = [
      { session_name: 'Session 3', count: 120 },
      { session_name: 'Session 1', count: 80 },
      { session_name: 'Session 2', count: 100 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    expect(sorted.map((s) => s.session_name)).toEqual(['Session 1', 'Session 2', 'Session 3'])
  })

  it('should sort quest sessions chronologically within their group', () => {
    const data = [
      { session_name: 'Quest B', count: 15 },
      { session_name: 'Teen Quest', count: 20 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    expect(sorted.map((s) => s.session_name)).toEqual(['Teen Quest', 'Quest B'])
  })

  it('should use name-based tiebreaker for same date', () => {
    const data = [
      { session_name: 'Session 2a', count: 40 },
      { session_name: 'Session 2', count: 100 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    // Both have date 2026-07-01, Session 2 should sort before Session 2a by name
    expect(sorted.map((s) => s.session_name)).toEqual(['Session 2', 'Session 2a'])
  })

  it('should handle empty array', () => {
    expect(sortSessionDataByCampThenQuest([], dateLookup, typeLookup)).toEqual([])
  })

  it('should not mutate original array', () => {
    const data = [
      { session_name: 'Quest B', count: 15 },
      { session_name: 'Session 1', count: 80 },
    ]
    const original = [...data]

    sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    expect(data).toEqual(original)
  })

  it('should preserve other fields', () => {
    const data = [
      { session_name: 'Teen Quest', count: 20, utilization: 50 },
      { session_name: 'Session 1', count: 80, utilization: 90 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)

    expect(sorted[0]).toEqual({ session_name: 'Session 1', count: 80, utilization: 90 })
    expect(sorted[1]).toEqual({ session_name: 'Teen Quest', count: 20, utilization: 50 })
  })

  it('should handle only camp sessions', () => {
    const data = [
      { session_name: 'Session 2', count: 100 },
      { session_name: 'Session 1', count: 80 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)
    expect(sorted.map((s) => s.session_name)).toEqual(['Session 1', 'Session 2'])
  })

  it('should handle only quest sessions', () => {
    const data = [
      { session_name: 'Quest B', count: 15 },
      { session_name: 'Teen Quest', count: 20 },
    ]

    const sorted = sortSessionDataByCampThenQuest(data, dateLookup, typeLookup)
    expect(sorted.map((s) => s.session_name)).toEqual(['Teen Quest', 'Quest B'])
  })
})
