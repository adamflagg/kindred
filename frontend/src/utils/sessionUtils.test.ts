/**
 * Tests for session URL utilities
 */
import { describe, it, expect } from 'vitest';
import {
  sessionNameToUrl,
  urlToSessionName,
  isKnownSessionUrl,
  isNumericSessionId,
  findSessionByUrlSegment,
  isValidTab,
  VALID_TABS,
} from './sessionUtils';
import type { Session } from '../types/app-types';

describe('sessionNameToUrl', () => {
  it('should convert known session names to URL segments', () => {
    expect(sessionNameToUrl('Taste of Camp')).toBe('taste');
    expect(sessionNameToUrl('Session 1')).toBe('1');
    expect(sessionNameToUrl('Session 2')).toBe('2');
    expect(sessionNameToUrl('Session 2a')).toBe('2a');
    expect(sessionNameToUrl('Session 2b')).toBe('2b');
    expect(sessionNameToUrl('Session 3')).toBe('3');
    expect(sessionNameToUrl('Session 3a')).toBe('3a');
    expect(sessionNameToUrl('Session 4')).toBe('4');
  });

  it('should convert unknown session names to URL-friendly format', () => {
    expect(sessionNameToUrl('All-Gender Session')).toBe('all-gender-session');
    expect(sessionNameToUrl('Special Event!')).toBe('special-event');
    expect(sessionNameToUrl('Multiple   Spaces')).toBe('multiple-spaces');
  });

  it('should handle empty string', () => {
    expect(sessionNameToUrl('')).toBe('');
  });
});

describe('urlToSessionName', () => {
  it('should convert known URL segments to session names', () => {
    expect(urlToSessionName('taste')).toBe('Taste of Camp');
    expect(urlToSessionName('1')).toBe('Session 1');
    expect(urlToSessionName('2')).toBe('Session 2');
    expect(urlToSessionName('2a')).toBe('Session 2a');
    expect(urlToSessionName('3')).toBe('Session 3');
    expect(urlToSessionName('4')).toBe('Session 4');
  });

  it('should return null for unknown URL segments', () => {
    expect(urlToSessionName('unknown')).toBe(null);
    expect(urlToSessionName('special-event')).toBe(null);
  });
});

describe('isKnownSessionUrl', () => {
  it('should return true for known URL segments', () => {
    expect(isKnownSessionUrl('taste')).toBe(true);
    expect(isKnownSessionUrl('1')).toBe(true);
    expect(isKnownSessionUrl('2a')).toBe(true);
  });

  it('should return false for unknown URL segments', () => {
    expect(isKnownSessionUrl('unknown')).toBe(false);
    expect(isKnownSessionUrl('5')).toBe(false);
  });
});

describe('isNumericSessionId', () => {
  it('should return true for numeric strings', () => {
    expect(isNumericSessionId('123')).toBe(true);
    expect(isNumericSessionId('1234567')).toBe(true);
    expect(isNumericSessionId('0')).toBe(true);
  });

  it('should return false for non-numeric strings', () => {
    expect(isNumericSessionId('2a')).toBe(false);
    expect(isNumericSessionId('taste')).toBe(false);
    expect(isNumericSessionId('')).toBe(false);
    expect(isNumericSessionId('12.34')).toBe(false);
  });
});

describe('findSessionByUrlSegment', () => {
  const mockSessions: Session[] = [
    {
      id: 's1',
      name: 'Taste of Camp',
      cm_id: 1001,
      start_date: '2025-06-01',
      end_date: '2025-06-07',
      session_type: 'main',
      year: 2025,
      code: '',
      persistent_id: '',
      created: '',
      updated: '',
    },
    {
      id: 's2',
      name: 'Session 2',
      cm_id: 1002,
      start_date: '2025-06-15',
      end_date: '2025-07-01',
      session_type: 'main',
      year: 2025,
      code: '',
      persistent_id: '',
      created: '',
      updated: '',
    },
    {
      id: 's3',
      name: 'All-Gender Cabin',
      cm_id: 1003,
      start_date: '2025-06-15',
      end_date: '2025-07-01',
      session_type: 'ag',
      year: 2025,
      code: '',
      persistent_id: '',
      created: '',
      updated: '',
    },
  ];

  it('should find session by known URL segment', () => {
    const result = findSessionByUrlSegment(mockSessions, 'taste');
    expect(result?.name).toBe('Taste of Camp');
  });

  it('should find session by numeric CM ID', () => {
    const result = findSessionByUrlSegment(mockSessions, '1002');
    expect(result?.name).toBe('Session 2');
  });

  it('should find session by URL-friendly name', () => {
    const result = findSessionByUrlSegment(mockSessions, 'all-gender-cabin');
    expect(result?.name).toBe('All-Gender Cabin');
  });

  it('should return null for non-existent session', () => {
    const result = findSessionByUrlSegment(mockSessions, 'nonexistent');
    expect(result).toBe(null);
  });

  it('should return null for empty sessions array', () => {
    const result = findSessionByUrlSegment([], 'taste');
    expect(result).toBe(null);
  });
});

describe('isValidTab', () => {
  it('should return true for valid tabs', () => {
    for (const tab of VALID_TABS) {
      expect(isValidTab(tab)).toBe(true);
    }
  });

  it('should return false for invalid tabs', () => {
    expect(isValidTab('invalid')).toBe(false);
    expect(isValidTab('settings')).toBe(false);
    expect(isValidTab('')).toBe(false);
  });
});

describe('VALID_TABS', () => {
  it('should contain expected tabs', () => {
    expect(VALID_TABS).toContain('bunks');
    expect(VALID_TABS).toContain('campers');
    expect(VALID_TABS).toContain('requests');
    expect(VALID_TABS).toContain('review');
    expect(VALID_TABS).toContain('friends');
    expect(VALID_TABS).toContain('logs');
  });
});

// Import sorting functions for testing
import {
  parseSessionName,
  sortSessionsLogically,
  sortSessionDataByName,
  sortPriorSessionData,
} from './sessionUtils';

describe('parseSessionName', () => {
  it('should parse main session names correctly', () => {
    expect(parseSessionName('Session 1')).toEqual([1, '']);
    expect(parseSessionName('Session 2')).toEqual([2, '']);
    expect(parseSessionName('Session 3')).toEqual([3, '']);
    expect(parseSessionName('Session 4')).toEqual([4, '']);
  });

  it('should parse embedded session names with suffixes', () => {
    expect(parseSessionName('Session 2a')).toEqual([2, 'a']);
    expect(parseSessionName('Session 2b')).toEqual([2, 'b']);
    expect(parseSessionName('Session 3a')).toEqual([3, 'a']);
  });

  it('should handle "Taste of Camp" as session 0', () => {
    expect(parseSessionName('Taste of Camp')).toEqual([0, 'taste of camp']);
  });

  it('should handle case insensitivity', () => {
    expect(parseSessionName('SESSION 2')).toEqual([2, '']);
    expect(parseSessionName('session 3A')).toEqual([3, 'a']);
  });

  it('should handle unknown session names', () => {
    expect(parseSessionName('Unknown Session')).toEqual([0, 'unknown session']);
    expect(parseSessionName('')).toEqual([0, '']);
  });
});

describe('sortSessionsLogically', () => {
  it('should sort sessions in logical order', () => {
    const sessions = [
      { name: 'Session 4' },
      { name: 'Session 2' },
      { name: 'Session 3a' },
      { name: 'Taste of Camp' },
      { name: 'Session 2b' },
      { name: 'Session 3' },
      { name: 'Session 2a' },
    ];

    const sorted = sortSessionsLogically(sessions);

    expect(sorted.map((s) => s.name)).toEqual([
      'Taste of Camp',
      'Session 2',
      'Session 2a',
      'Session 2b',
      'Session 3',
      'Session 3a',
      'Session 4',
    ]);
  });

  it('should handle empty array', () => {
    expect(sortSessionsLogically([])).toEqual([]);
  });

  it('should not mutate original array', () => {
    const sessions = [{ name: 'Session 4' }, { name: 'Session 2' }];
    const original = [...sessions];
    sortSessionsLogically(sessions);
    expect(sessions).toEqual(original);
  });
});

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
    ];

    const sorted = sortSessionDataByName(data);

    expect(sorted.map((s) => s.session_name)).toEqual([
      'Taste of Camp',
      'Session 2',
      'Session 2a',
      'Session 2b',
      'Session 3',
      'Session 3a',
      'Session 4',
    ]);
  });

  it('should preserve other fields', () => {
    const data = [
      { session_name: 'Session 4', count: 100, capacity: 120 },
      { session_name: 'Session 2', count: 150, capacity: 160 },
    ];

    const sorted = sortSessionDataByName(data);

    expect(sorted[0]).toEqual({ session_name: 'Session 2', count: 150, capacity: 160 });
    expect(sorted[1]).toEqual({ session_name: 'Session 4', count: 100, capacity: 120 });
  });

  it('should handle empty array', () => {
    expect(sortSessionDataByName([])).toEqual([]);
  });

  it('should not mutate original array', () => {
    const data = [
      { session_name: 'Session 4', count: 100 },
      { session_name: 'Session 2', count: 150 },
    ];
    const original = [...data];
    sortSessionDataByName(data);
    expect(data).toEqual(original);
  });
});

describe('sortPriorSessionData', () => {
  it('should sort data objects by prior_session field', () => {
    const data = [
      { prior_session: 'Session 4', returned_count: 80 },
      { prior_session: 'Session 2', returned_count: 120 },
      { prior_session: 'Session 3a', returned_count: 40 },
      { prior_session: 'Taste of Camp', returned_count: 25 },
      { prior_session: 'Session 2b', returned_count: 35 },
      { prior_session: 'Session 3', returned_count: 100 },
      { prior_session: 'Session 2a', returned_count: 38 },
    ];

    const sorted = sortPriorSessionData(data);

    expect(sorted.map((s) => s.prior_session)).toEqual([
      'Taste of Camp',
      'Session 2',
      'Session 2a',
      'Session 2b',
      'Session 3',
      'Session 3a',
      'Session 4',
    ]);
  });

  it('should preserve other fields', () => {
    const data = [
      { prior_session: 'Session 4', returned_count: 80, retention_rate: 0.8 },
      { prior_session: 'Session 2', returned_count: 120, retention_rate: 0.75 },
    ];

    const sorted = sortPriorSessionData(data);

    expect(sorted[0]).toEqual({ prior_session: 'Session 2', returned_count: 120, retention_rate: 0.75 });
    expect(sorted[1]).toEqual({ prior_session: 'Session 4', returned_count: 80, retention_rate: 0.8 });
  });

  it('should handle empty array', () => {
    expect(sortPriorSessionData([])).toEqual([]);
  });

  it('should not mutate original array', () => {
    const data = [
      { prior_session: 'Session 4', returned_count: 80 },
      { prior_session: 'Session 2', returned_count: 120 },
    ];
    const original = [...data];
    sortPriorSessionData(data);
    expect(data).toEqual(original);
  });
});
