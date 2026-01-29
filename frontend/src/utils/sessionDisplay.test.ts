import { describe, it, expect } from 'vitest';
import {
  getFormattedSessionName,
  getSessionDisplayName,
  getParentSessionId,
  getSessionDisplayNameFromString,
  getSessionChartLabel,
  getSessionShorthand,
} from './sessionDisplay';
import type { Session } from '../types/app-types';

describe('sessionDisplay utilities', () => {
  // Mock sessions for testing parent relationships
  const mockAllSessions: Session[] = [
    {
      id: 'main-2',
      name: 'Session 2',
      session_type: 'main',
      persistent_id: 'main2',
      start_date: '2025-06-01',
      end_date: '2025-06-14',
      cm_id: 200,
      year: 2025,
      created: '',
      updated: ''
    },
    {
      id: 'main-3',
      name: 'Session 3',
      session_type: 'main',
      persistent_id: 'main3',
      start_date: '2025-06-15',
      end_date: '2025-06-28',
      cm_id: 300,
      year: 2025,
      created: '',
      updated: ''
    },
    {
      id: 'ag-2',
      name: 'All-Gender Cabin-Session 2 (7th - 9th grades)',
      session_type: 'ag',
      persistent_id: 'ag2',
      parent_id: 200,  // Points to Session 2
      start_date: '2025-06-01',
      end_date: '2025-06-14',
      cm_id: 201,
      year: 2025,
      created: '',
      updated: ''
    }
  ];

  describe('getSessionDisplayName', () => {
    it('should handle undefined session', () => {
      expect(getSessionDisplayName(undefined)).toBe('Unknown Session');
    });

    it('should use parent session name for AG sessions when allSessions provided', () => {
      const agSession = mockAllSessions[2];
      if (!agSession) throw new Error('AG session not found');
      
      // With allSessions, should return parent's display name
      expect(getSessionDisplayName(agSession, mockAllSessions)).toBe('Session 2');
    });

    it('should fallback to original name when allSessions not provided', () => {
      const agSession: Session = {
        id: '1',
        name: 'All-Gender Cabin-Session 2',
        session_type: 'ag',
        persistent_id: 'ag2',
        parent_id: 200,
        start_date: '2025-06-01',
        end_date: '2025-06-14',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      // Without allSessions, should return original name
      expect(getSessionDisplayName(agSession)).toBe('All-Gender Cabin-Session 2');
    });

    it('should handle embedded sessions', () => {
      const embeddedSession: Session = {
        id: '2',
        name: 'Session 2a',
        session_type: 'embedded',
        code: '2a',
        persistent_id: '2a',
        start_date: '2025-06-01',
        end_date: '2025-06-07',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getSessionDisplayName(embeddedSession)).toBe('Session 2a');
    });

    it('should handle main sessions', () => {
      const mainSession: Session = {
        id: '3',
        name: 'Session 2',
        session_type: 'main',
        persistent_id: 'main2',
        start_date: '2025-06-01',
        end_date: '2025-06-14',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getSessionDisplayName(mainSession)).toBe('Session 2');
    });

    it('should handle taste sessions', () => {
      const tasteSession: Session = {
        id: '4',
        name: 'Taste of Camp',
        session_type: 'taste',
        persistent_id: 'taste',
        start_date: '2025-05-25',
        end_date: '2025-05-28',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getSessionDisplayName(tasteSession)).toBe('Taste of Camp');
    });

    it('should fallback to original name for unknown types', () => {
      const otherSession: Session = {
        id: '5',
        name: 'Family Camp 1',
        session_type: 'family',
        persistent_id: 'family1',
        start_date: '2025-08-01',
        end_date: '2025-08-07',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getSessionDisplayName(otherSession)).toBe('Family Camp 1');
    });

    it('should handle missing persistent_id', () => {
      const session: Session = {
        id: '6',
        name: 'Some Session',
        session_type: 'ag',
        start_date: '2025-06-01',
        end_date: '2025-06-14',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getSessionDisplayName(session)).toBe('Some Session');
    });
  });

  describe('getParentSessionId', () => {
    it('should return parent session ID for AG session with parent_id', () => {
      const agSession = mockAllSessions[2];
      if (!agSession) {
        throw new Error('AG session not found in test data');
      }
      // AG session has parent_id pointing to Session 2 (cm_id: 200)
      expect(getParentSessionId(agSession, mockAllSessions)).toBe(200);
    });

    it('should return original ID for non-AG sessions', () => {
      const mainSession = mockAllSessions[0];
      if (!mainSession) {
        throw new Error('Main session not found in test data');
      }
      expect(getParentSessionId(mainSession, mockAllSessions)).toBe(200);
    });

    it('should return original ID if no parent found', () => {
      const agSession: Session = {
        id: 'ag-99',
        name: 'All-Gender Cabin-Session 99',
        session_type: 'ag',
        persistent_id: 'ag99',
        start_date: '2025-06-01',
        end_date: '2025-06-14',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      expect(getParentSessionId(agSession, mockAllSessions)).toBe(123);
    });

    it('should handle different persistent_id formats', () => {
      const agSession: Session = {
        id: 'ag-3',
        name: 'All-Gender Cabin-Session 3',
        session_type: 'ag',
        persistent_id: 'ag_main3',
        start_date: '2025-06-15',
        end_date: '2025-06-28',
        cm_id: 123,
        year: 2025,
        created: '',
        updated: ''
      };
      // Should return parent session's cm_id (main3 has cm_id 300), not the AG session's cm_id
      expect(getParentSessionId(agSession, mockAllSessions)).toBe(300);
    });
  });

  describe('getSessionDisplayNameFromString', () => {
    it('should handle empty session name', () => {
      expect(getSessionDisplayNameFromString('')).toBe('Unknown Session');
      expect(getSessionDisplayNameFromString('', 'ag')).toBe('Unknown Session');
    });

    it('should transform AG sessions by type', () => {
      expect(getSessionDisplayNameFromString('Some AG Session', 'ag')).toBe('Some AG Session');
      expect(getSessionDisplayNameFromString('AG Session 2', 'ag')).toBe('Session 2');
    });

    it('should transform AG sessions by name pattern', () => {
      expect(getSessionDisplayNameFromString('All-Gender Cabin-Session 2')).toBe('Session 2');
      expect(getSessionDisplayNameFromString('Session 3 All-Gender')).toBe('Session 3');
      expect(getSessionDisplayNameFromString('ag session 3')).toBe('Session 3');
    });

    it('should return original name if no transformation needed', () => {
      expect(getSessionDisplayNameFromString('Session 2')).toBe('Session 2');
      expect(getSessionDisplayNameFromString('Taste of Camp')).toBe('Taste of Camp');
      expect(getSessionDisplayNameFromString('Family Camp 1')).toBe('Family Camp 1');
    });
  });

  describe('getFormattedSessionName', () => {
    it('should return "Unknown Session" for undefined session', () => {
      expect(getFormattedSessionName(undefined)).toBe('Unknown Session');
    });

    it('should return "Unknown Session" for session without name', () => {
      const session: Session = {
        id: '1',
        name: '',
        session_type: 'main',
        cm_id: 123,
        year: 2025,
        start_date: '',
        end_date: '',
        created: '',
        updated: '',
      };
      expect(getFormattedSessionName(session)).toBe('Unknown Session');
    });

    it('should return parent name for AG session when allSessions provided', () => {
      const agSession: Session = {
        id: 'ag-2',
        name: 'All-Gender Cabin-Session 2',
        session_type: 'ag',
        parent_id: 200,
        cm_id: 201,
        year: 2025,
        start_date: '',
        end_date: '',
        created: '',
        updated: '',
      };
      const allSessions: Session[] = [
        {
          id: 'main-2',
          name: 'Session 2',
          session_type: 'main',
          cm_id: 200,
          year: 2025,
          start_date: '',
          end_date: '',
          created: '',
          updated: '',
        },
      ];
      expect(getFormattedSessionName(agSession, allSessions)).toBe('Session 2');
    });

    it('should return original name for AG session when parent not found', () => {
      const agSession: Session = {
        id: 'ag-99',
        name: 'All-Gender Cabin-Session 99',
        session_type: 'ag',
        parent_id: 9999,
        cm_id: 201,
        year: 2025,
        start_date: '',
        end_date: '',
        created: '',
        updated: '',
      };
      expect(getFormattedSessionName(agSession, [])).toBe('All-Gender Cabin-Session 99');
    });

    it('should return original name for non-AG sessions', () => {
      const mainSession: Session = {
        id: 'main-2',
        name: 'Session 2',
        session_type: 'main',
        cm_id: 200,
        year: 2025,
        start_date: '',
        end_date: '',
        created: '',
        updated: '',
      };
      expect(getFormattedSessionName(mainSession)).toBe('Session 2');
    });
  });

  describe('getSessionChartLabel', () => {
    it('should return "Unknown" for empty session name', () => {
      expect(getSessionChartLabel('')).toBe('Unknown');
    });

    it('should return "Taste of Camp" for taste sessions', () => {
      expect(getSessionChartLabel('Taste of Camp')).toBe('Taste of Camp');
      expect(getSessionChartLabel('Taste of Camp 2025', 'taste')).toBe('Taste of Camp');
    });

    it('should abbreviate AG sessions and preserve grade ranges', () => {
      expect(getSessionChartLabel('All-Gender Cabin-Session 2', 'ag')).toBe('All-Gender 2');
      expect(getSessionChartLabel('All-Gender Cabin-Session 2 (Grades 6-8)', 'ag')).toBe('All-Gender 2 (6-8)');
      expect(getSessionChartLabel('All-Gender Cabin-Session 3 (Grades 3-5) 2025')).toBe('All-Gender 3 (3-5)');
      expect(getSessionChartLabel('AG Session 4', 'ag')).toBe('All-Gender 4');
    });

    it('should preserve main session format', () => {
      expect(getSessionChartLabel('Session 2')).toBe('Session 2');
      expect(getSessionChartLabel('Session 3', 'main')).toBe('Session 3');
    });

    it('should preserve embedded session format', () => {
      expect(getSessionChartLabel('Session 2a', 'embedded')).toBe('Session 2a');
      expect(getSessionChartLabel('Session 3b')).toBe('Session 3b');
    });

    it('should truncate very long names without grade ranges', () => {
      expect(getSessionChartLabel('Some Very Long Session Name That Goes On Forever')).toBe('Some Very Long Session...');
    });
  });

  describe('getSessionShorthand', () => {
    it('should return empty string for empty session name', () => {
      expect(getSessionShorthand('')).toBe('');
    });

    it('should return "Taste" for Taste of Camp sessions', () => {
      expect(getSessionShorthand('Taste of Camp')).toBe('Taste');
      expect(getSessionShorthand('Taste of Camp 2025', 'taste')).toBe('Taste');
    });

    it('should extract session number from "Session N" format', () => {
      expect(getSessionShorthand('Session 2')).toBe('2');
      expect(getSessionShorthand('Session 3')).toBe('3');
      expect(getSessionShorthand('Session 2a')).toBe('2a');
      expect(getSessionShorthand('Session 3b')).toBe('3b');
    });

    it('should extract number from AG sessions', () => {
      expect(getSessionShorthand('AG Session 2', 'ag')).toBe('2');
      expect(getSessionShorthand('All-Gender Cabin-Session 3')).toBe('3');
      expect(getSessionShorthand('Session 2 All-Gender')).toBe('2');
    });

    it('should fallback to number extraction', () => {
      expect(getSessionShorthand('Camp Week 4')).toBe('4');
      expect(getSessionShorthand('Week 2a Program')).toBe('2a');
    });

    it('should return first word as last resort', () => {
      expect(getSessionShorthand('Family Camp')).toBe('Family');
      expect(getSessionShorthand('Special Event')).toBe('Special');
    });

    it('should handle AG session type parameter', () => {
      expect(getSessionShorthand('Some AG Session 2', 'ag')).toBe('2');
    });
  });

  describe('getSessionChartLabel with date lookup', () => {
    it('should append date to Taste of Camp when date lookup provided', () => {
      const dateLookup = {
        'Taste of Camp 1': '2026-06-01',
        'Taste of Camp 2': '2026-06-08',
      };

      expect(getSessionChartLabel('Taste of Camp 1', undefined, dateLookup)).toBe('Taste of Camp (Jun 1)');
      expect(getSessionChartLabel('Taste of Camp 2', undefined, dateLookup)).toBe('Taste of Camp (Jun 8)');
    });

    it('should append date when session name contains "taste" and date available', () => {
      const dateLookup = {
        'Taste of Camp': '2026-06-15',
      };

      expect(getSessionChartLabel('Taste of Camp', 'taste', dateLookup)).toBe('Taste of Camp (Jun 15)');
    });

    it('should not append date to non-Taste sessions', () => {
      const dateLookup = {
        'Session 2': '2026-06-15',
        'Session 3': '2026-07-01',
      };

      expect(getSessionChartLabel('Session 2', 'main', dateLookup)).toBe('Session 2');
      expect(getSessionChartLabel('Session 3', 'main', dateLookup)).toBe('Session 3');
    });

    it('should not append date if date lookup is empty', () => {
      expect(getSessionChartLabel('Taste of Camp', 'taste', {})).toBe('Taste of Camp');
    });

    it('should not append date if session not in lookup', () => {
      const dateLookup = {
        'Other Session': '2026-06-01',
      };

      expect(getSessionChartLabel('Taste of Camp', 'taste', dateLookup)).toBe('Taste of Camp');
    });

    it('should work without date lookup (backward compatibility)', () => {
      expect(getSessionChartLabel('Taste of Camp')).toBe('Taste of Camp');
      expect(getSessionChartLabel('Session 2')).toBe('Session 2');
    });
  });
});