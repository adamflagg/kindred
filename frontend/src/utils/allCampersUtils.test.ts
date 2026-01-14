import { describe, it, expect } from 'vitest';
import {
  filterSummerCampBunks,
  getDropdownSessions,
  getSessionRelationshipsForCamperView,
  type SessionWithType
} from './allCampersUtils';
import type { BunksResponse, BunkPlansResponse } from '../types/pocketbase-types';
import type { Session } from '../types/app-types';
import { expectDefined } from '../test/testUtils';

// Mock data helper - accepts partial overrides and required fields
function createMockSession(
  overrides: Partial<Session> & {
    name: string;
    session_type: Session['session_type'];
  }
): Session {
  const id = overrides.id ?? `session-${overrides.name.replace(/\s/g, '-').toLowerCase()}`;
  return {
    id,
    collectionId: 'sessions',
    collectionName: 'camp_sessions',
    created: '',
    updated: '',
    cm_id: overrides.cm_id ?? Math.floor(Math.random() * 10000),
    year: overrides.year ?? 2025,
    start_date: overrides.start_date ?? '2025-06-01',
    end_date: overrides.end_date ?? '2025-06-14',
    ...overrides
  };
}

function createMockBunk(name: string, gender: 'M' | 'F' | 'Mixed' = 'M'): BunksResponse {
  return {
    id: `bunk-${name.toLowerCase().replace(/\s/g, '-')}`,
    collectionId: 'bunks',
    collectionName: 'bunks',
    created: '',
    updated: '',
    name,
    gender,
    cm_id: Math.floor(Math.random() * 10000)
  } as BunksResponse;
}

function createMockBunkPlan(bunkId: string, sessionId: string, year: number = 2025): BunkPlansResponse {
  return {
    id: `bp-${bunkId}-${sessionId}`,
    collectionId: 'bunk_plans',
    collectionName: 'bunk_plans',
    created: '',
    updated: '',
    bunk: bunkId,
    session: sessionId,
    year
  } as BunkPlansResponse;
}

describe('allCampersUtils', () => {
  describe('filterSummerCampBunks', () => {
    it('should include bunks linked to main sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' })
      ];
      const bunks = [
        createMockBunk('B-1'),
        createMockBunk('B-2')
      ];
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'main-2')
      ];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(2);
      expect(result.map((b: BunksResponse) => b.name)).toContain('B-1');
      expect(result.map((b: BunksResponse) => b.name)).toContain('B-2');
    });

    it('should include bunks linked to AG sessions', () => {
      const sessions = [
        createMockSession({ name: 'All-Gender Session 2', session_type: 'ag', id: 'ag-2' })
      ];
      const bunks = [createMockBunk('AG-8', 'Mixed')];
      const bunkPlans = [createMockBunkPlan(expectDefined(bunks[0]).id, 'ag-2')];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('AG-8');
    });

    it('should include bunks linked to embedded sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2a', session_type: 'embedded', id: 'emb-2a' })
      ];
      const bunks = [createMockBunk('B-1'), createMockBunk('G-1', 'F')];
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'emb-2a'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'emb-2a')
      ];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(2);
    });

    it('should EXCLUDE bunks only linked to family camp sessions', () => {
      const sessions = [
        createMockSession({ name: 'Family Camp 1', session_type: 'family', id: 'fam-1' })
      ];
      const bunks = [
        createMockBunk('Acorns (with parents)'),
        createMockBunk('Azaleas')
      ];
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'fam-1'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'fam-1')
      ];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(0);
    });

    it('should include bunks linked to both family AND main sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' }),
        createMockSession({ name: 'Family Camp 1', session_type: 'family', id: 'fam-1' })
      ];
      // This bunk is used in both summer and family camp
      const bunks = [createMockBunk('B-1')];
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2'),
        createMockBunkPlan(expectDefined(bunks[0]).id, 'fam-1')
      ];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('B-1');
    });

    it('should exclude bunks with no bunk_plans at all', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' })
      ];
      const bunks = [
        createMockBunk('B-1'),
        createMockBunk('Orphan-Bunk') // No bunk_plan
      ];
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2')
        // No plan for Orphan-Bunk
      ];

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('B-1');
    });

    it('should sort bunks by name (B-*, G-*, AG-* ordering)', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' }),
        createMockSession({ name: 'All-Gender Session 2', session_type: 'ag', id: 'ag-2' })
      ];
      const bunks = [
        createMockBunk('G-1', 'F'),
        createMockBunk('AG-8', 'Mixed'),
        createMockBunk('B-2'),
        createMockBunk('B-1'),
        createMockBunk('G-2', 'F')
      ];
      const bunkPlans = bunks.map((b: BunksResponse) =>
        createMockBunkPlan(b.id, b.gender === 'Mixed' ? 'ag-2' : 'main-2')
      );

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions);
      expect(result.map((b: BunksResponse) => b.name)).toEqual(['AG-8', 'B-1', 'B-2', 'G-1', 'G-2']);
    });
  });

  describe('getDropdownSessions', () => {
    it('should include main sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'Session 3', session_type: 'main', cm_id: 300 })
      ];

      const result = getDropdownSessions(sessions);
      expect(result).toHaveLength(2);
      expect(result.map((s: Session) => s.name)).toContain('Session 2');
      expect(result.map((s: Session) => s.name)).toContain('Session 3');
    });

    it('should include embedded sessions as independent entries', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200, start_date: '2025-06-01', end_date: '2025-06-14' }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', cm_id: 210, start_date: '2025-06-01', end_date: '2025-06-07' }),
        createMockSession({ name: 'Session 2b', session_type: 'embedded', cm_id: 211, start_date: '2025-06-08', end_date: '2025-06-14' })
      ];

      const result = getDropdownSessions(sessions);
      expect(result).toHaveLength(3);
      expect(result.map((s: Session) => s.name)).toContain('Session 2');
      expect(result.map((s: Session) => s.name)).toContain('Session 2a');
      expect(result.map((s: Session) => s.name)).toContain('Session 2b');
    });

    it('should EXCLUDE AG sessions from dropdown (they are grouped with parent)', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', cm_id: 200 }),
        createMockSession({ name: 'All-Gender Session 2', session_type: 'ag', cm_id: 201, parent_id: 200 })
      ];

      const result = getDropdownSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Session 2');
    });

    it('should include Taste of Camp (which is a main session)', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Taste of Camp', session_type: 'main' })
      ];

      const result = getDropdownSessions(sessions);
      expect(result).toHaveLength(2);
      expect(result.map((s: Session) => s.name)).toContain('Taste of Camp');
    });

    it('should EXCLUDE family camp sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Family Camp 1', session_type: 'family' })
      ];

      const result = getDropdownSessions(sessions);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Session 2');
    });

    it('should sort sessions by start_date', () => {
      const sessions = [
        createMockSession({ name: 'Session 3', session_type: 'main', start_date: '2025-06-15' }),
        createMockSession({ name: 'Taste of Camp', session_type: 'main', start_date: '2025-05-25' }),
        createMockSession({ name: 'Session 2', session_type: 'main', start_date: '2025-06-01' }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', start_date: '2025-06-01' })
      ];

      const result = getDropdownSessions(sessions);
      expect(result.map((s: Session) => s.name)).toEqual(['Taste of Camp', 'Session 2', 'Session 2a', 'Session 3']);
    });
  });

  describe('getSessionRelationshipsForCamperView', () => {
    it('should group AG sessions with their parent main session', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2', cm_id: 200 }),
        createMockSession({ name: 'All-Gender Session 2', session_type: 'ag', id: 'ag-2', cm_id: 201, parent_id: 200 })
      ];

      const relationships = getSessionRelationshipsForCamperView(sessions);

      // Main session should include itself and AG session
      expect(relationships.get('main-2')).toContain('main-2');
      expect(relationships.get('main-2')).toContain('ag-2');
    });

    it('should NOT group embedded sessions with main sessions', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2', cm_id: 200, start_date: '2025-06-01', end_date: '2025-06-14' }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', id: 'emb-2a', cm_id: 210, start_date: '2025-06-01', end_date: '2025-06-07' })
      ];

      const relationships = getSessionRelationshipsForCamperView(sessions);

      // Main session should only include itself
      expect(relationships.get('main-2')).toEqual(['main-2']);

      // Embedded session should be its own entry (not grouped with main)
      expect(relationships.get('emb-2a')).toEqual(['emb-2a']);
    });

    it('should keep each embedded session independent', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2', cm_id: 200 }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded', id: 'emb-2a', cm_id: 210 }),
        createMockSession({ name: 'Session 2b', session_type: 'embedded', id: 'emb-2b', cm_id: 211 })
      ];

      const relationships = getSessionRelationshipsForCamperView(sessions);

      // Each embedded session should be independent
      expect(relationships.get('emb-2a')).toEqual(['emb-2a']);
      expect(relationships.get('emb-2b')).toEqual(['emb-2b']);

      // Main session should NOT include embedded sessions
      expect(relationships.get('main-2')).toEqual(['main-2']);
    });

    it('should handle AG sessions linking to main via parent_id', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'Session 3', session_type: 'main', id: 'main-3', cm_id: 300 }),
        createMockSession({ name: 'AG Session 3 (7th-8th)', session_type: 'ag', id: 'ag-3a', cm_id: 301, parent_id: 300 }),
        createMockSession({ name: 'AG Session 3 (9th-10th)', session_type: 'ag', id: 'ag-3b', cm_id: 302, parent_id: 300 })
      ];

      const relationships = getSessionRelationshipsForCamperView(sessions);

      // Main session should include itself and both AG sessions
      const mainRelated = relationships.get('main-3');
      expect(mainRelated).toContain('main-3');
      expect(mainRelated).toContain('ag-3a');
      expect(mainRelated).toContain('ag-3b');
    });
  });
});
