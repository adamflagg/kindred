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
