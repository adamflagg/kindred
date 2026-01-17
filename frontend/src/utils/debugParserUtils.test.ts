import { describe, it, expect } from 'vitest';
import {
  getDebugDropdownSessions,
  buildAgSessionCmIdMap,
  getEffectiveCmIds,
  filterByRequesterName,
  type DebugSession,
} from './debugParserUtils';

// Helper to create mock sessions
function createMockSession(
  overrides: Partial<DebugSession> & { name: string; session_type: string }
): DebugSession {
  return {
    id: overrides.id ?? `session-${overrides.name.replace(/\s/g, '-').toLowerCase()}`,
    cm_id: overrides.cm_id ?? Math.floor(Math.random() * 10000),
    ...overrides,
  };
}

describe('debugParserUtils', () => {
  describe('getDebugDropdownSessions', () => {
    it('should include main sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'Session 3', session_type: 'main', cm_id: 300 }),
      ];

      const result = getDebugDropdownSessions(sessions);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toContain('Session 2');
      expect(result.map((s) => s.name)).toContain('Session 3');
    });

    it('should include embedded sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', cm_id: 210 }),
        createMockSession({ name: 'Session 2b', session_type: 'embedded', cm_id: 211 }),
      ];

      const result = getDebugDropdownSessions(sessions);
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.name)).toContain('Session 2a');
      expect(result.map((s) => s.name)).toContain('Session 2b');
    });

    it('should EXCLUDE AG sessions from dropdown', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({
          name: 'All-Gender Session 2',
          session_type: 'ag',
          cm_id: 201,
          parent_id: 200,
        }),
      ];

      const result = getDebugDropdownSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Session 2');
    });

    it('should EXCLUDE family camp sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'Family Camp 1', session_type: 'family', cm_id: 500 }),
      ];

      const result = getDebugDropdownSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Session 2');
    });

    it('should handle sessions without session_type', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        { id: 'unknown', cm_id: 999, name: 'Unknown Session' } as DebugSession, // No session_type
      ];

      const result = getDebugDropdownSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Session 2');
    });
  });

  describe('buildAgSessionCmIdMap', () => {
    it('should map AG sessions to their parent main session cm_id', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({
          name: 'AG Session 2',
          session_type: 'ag',
          cm_id: 201,
          parent_id: 200,
        }),
      ];

      const map = buildAgSessionCmIdMap(sessions);
      expect(map.get(200)).toEqual([201]);
    });

    it('should group multiple AG sessions under same parent', () => {
      const sessions = [
        createMockSession({ name: 'Session 3', session_type: 'main', cm_id: 300 }),
        createMockSession({
          name: 'AG Session 3 (7th-8th)',
          session_type: 'ag',
          cm_id: 301,
          parent_id: 300,
        }),
        createMockSession({
          name: 'AG Session 3 (9th-10th)',
          session_type: 'ag',
          cm_id: 302,
          parent_id: 300,
        }),
      ];

      const map = buildAgSessionCmIdMap(sessions);
      expect(map.get(300)).toContain(301);
      expect(map.get(300)).toContain(302);
      expect(map.get(300)).toHaveLength(2);
    });

    it('should return empty map when no AG sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', cm_id: 210 }),
      ];

      const map = buildAgSessionCmIdMap(sessions);
      expect(map.size).toBe(0);
    });

    it('should ignore AG sessions without parent_id', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({
          name: 'Orphan AG',
          session_type: 'ag',
          cm_id: 999,
          parent_id: null,
        }),
      ];

      const map = buildAgSessionCmIdMap(sessions);
      expect(map.size).toBe(0);
    });

    it('should handle AG sessions with parent that does not exist in list', () => {
      // This tests that we still create the mapping even if the parent session
      // isn't in our list (the map is keyed by cm_id, not by session object)
      const sessions = [
        createMockSession({
          name: 'AG Session for missing parent',
          session_type: 'ag',
          cm_id: 201,
          parent_id: 999, // Parent with cm_id 999 doesn't exist
        }),
      ];

      const map = buildAgSessionCmIdMap(sessions);
      expect(map.get(999)).toEqual([201]);
    });
  });

  describe('getEffectiveCmIds', () => {
    it('should return undefined when no session selected', () => {
      const agMap = new Map<number, number[]>();
      const result = getEffectiveCmIds(null, agMap);
      expect(result).toBeUndefined();
    });

    it('should return selected cm_id when no AG children', () => {
      const agMap = new Map<number, number[]>();
      const result = getEffectiveCmIds(200, agMap);
      expect(result).toEqual([200]);
    });

    it('should include AG children cm_ids when main session selected', () => {
      const agMap = new Map<number, number[]>();
      agMap.set(200, [201, 202]);

      const result = getEffectiveCmIds(200, agMap);
      expect(result).toEqual([200, 201, 202]);
    });

    it('should return just embedded session cm_id (no AG children)', () => {
      const agMap = new Map<number, number[]>();
      agMap.set(200, [201]); // Main session has AG child

      // Select embedded session (cm_id 210) - has no AG children
      const result = getEffectiveCmIds(210, agMap);
      expect(result).toEqual([210]);
    });
  });

  describe('filterByRequesterName', () => {
    interface MockItem {
      id: string;
      requester_name: string | null;
    }

    const items: MockItem[] = [
      { id: '1', requester_name: 'Emma Johnson' },
      { id: '2', requester_name: 'Liam Garcia' },
      { id: '3', requester_name: 'Olivia Chen' },
      { id: '4', requester_name: 'Noah Williams' },
      { id: '5', requester_name: null },
    ];

    it('should return all items when search query is empty', () => {
      const result = filterByRequesterName(items, '');
      expect(result).toHaveLength(5);
    });

    it('should return all items when search query is whitespace', () => {
      const result = filterByRequesterName(items, '   ');
      expect(result).toHaveLength(5);
    });

    it('should filter by partial first name', () => {
      const result = filterByRequesterName(items, 'emma');
      expect(result).toHaveLength(1);
      expect(result[0]?.requester_name).toBe('Emma Johnson');
    });

    it('should filter by partial last name', () => {
      const result = filterByRequesterName(items, 'chen');
      expect(result).toHaveLength(1);
      expect(result[0]?.requester_name).toBe('Olivia Chen');
    });

    it('should be case-insensitive', () => {
      const result = filterByRequesterName(items, 'GARCIA');
      expect(result).toHaveLength(1);
      expect(result[0]?.requester_name).toBe('Liam Garcia');
    });

    it('should match partial strings in middle of name', () => {
      const result = filterByRequesterName(items, 'li');
      // Matches: Liam, Olivia, Williams
      expect(result).toHaveLength(3);
      expect(result.map((i) => i.requester_name)).toContain('Liam Garcia');
      expect(result.map((i) => i.requester_name)).toContain('Olivia Chen');
      expect(result.map((i) => i.requester_name)).toContain('Noah Williams');
    });

    it('should exclude items with null requester_name', () => {
      const result = filterByRequesterName(items, 'test');
      expect(result).toHaveLength(0);
      // The item with null name should never match
    });

    it('should handle empty array', () => {
      const result = filterByRequesterName([], 'emma');
      expect(result).toHaveLength(0);
    });

    it('should trim whitespace from search query', () => {
      const result = filterByRequesterName(items, '  emma  ');
      expect(result).toHaveLength(1);
      expect(result[0]?.requester_name).toBe('Emma Johnson');
    });
  });
});
