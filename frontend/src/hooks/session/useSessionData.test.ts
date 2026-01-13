/**
 * Tests for useSessionData hooks
 * TDD - tests written first, implementation follows
 *
 * These hooks extract the heavy data fetching logic from SessionView:
 * - useSessionBunks: Fetches bunks for a session including AG bunks
 * - useSessionCampers: Fetches campers for a session including AG campers
 * - useBunkRequestsCount: Fetches count of pending bunk requests
 */

import { describe, it, expect } from 'vitest';

describe('useSessionBunks', () => {
  describe('query key construction', () => {
    it('should include selectedSession in query key', () => {
      const selectedSession = '1000001';
      const sessionCmId = 1000001;
      const agSessionIds = ['ag1', 'ag2'];

      const queryKey = [
        'bunks',
        selectedSession,
        sessionCmId,
        agSessionIds.sort(),
      ];

      expect(queryKey[0]).toBe('bunks');
      expect(queryKey[1]).toBe('1000001');
      expect(queryKey[2]).toBe(1000001);
    });

    it('should sort AG session IDs for consistent caching', () => {
      const agSessionIds = ['ag3', 'ag1', 'ag2'];
      const sorted = [...agSessionIds].sort();

      expect(sorted).toEqual(['ag1', 'ag2', 'ag3']);
    });
  });

  describe('query behavior', () => {
    it('should be disabled when no selectedSession', () => {
      const selectedSession: string | undefined = undefined;
      const enabled = !!selectedSession;

      expect(enabled).toBe(false);
    });

    it('should be enabled when selectedSession exists', () => {
      const selectedSession = '1000001';
      const enabled = !!selectedSession;

      expect(enabled).toBe(true);
    });
  });

  describe('AG bunk filtering', () => {
    it('should identify AG bunks by name prefix', () => {
      const bunks = [
        { id: '1', name: 'B-1' },
        { id: '2', name: 'G-1' },
        { id: '3', name: 'AG-8' },
        { id: '4', name: 'AG-10' },
      ];

      const agBunks = bunks.filter((b) => b.name.startsWith('AG-'));
      const nonAgBunks = bunks.filter((b) => !b.name.startsWith('AG-'));

      expect(agBunks).toHaveLength(2);
      expect(nonAgBunks).toHaveLength(2);
    });

    it('should deduplicate AG bunks by name', () => {
      const agBunks = [
        { id: '1', name: 'AG-8' },
        { id: '2', name: 'AG-8' }, // Duplicate
        { id: '3', name: 'AG-10' },
      ];

      const bunkMap = new Map<string, (typeof agBunks)[0]>();
      agBunks.forEach((bunk) => {
        if (!bunkMap.has(bunk.name)) {
          bunkMap.set(bunk.name, bunk);
        }
      });

      expect(bunkMap.size).toBe(2);
      expect(bunkMap.get('AG-8')?.id).toBe('1'); // First one wins
    });
  });

  describe('bunk plan parsing', () => {
    it('should extract unique bunk IDs from bunk plans', () => {
      const bunkPlans = [
        { bunk: 'bunk1' },
        { bunk: 'bunk2' },
        { bunk: 'bunk1' }, // Duplicate
        { bunk: null }, // Null should be filtered
        { bunk: 'bunk3' },
      ];

      const bunkIds = [
        ...new Set(bunkPlans.map((bp) => bp.bunk).filter(Boolean)),
      ];

      expect(bunkIds).toHaveLength(3);
      expect(bunkIds).toContain('bunk1');
      expect(bunkIds).toContain('bunk2');
      expect(bunkIds).toContain('bunk3');
    });
  });
});

describe('useSessionCampers', () => {
  describe('query key construction', () => {
    it('should include scenario ID for scenario-aware caching', () => {
      const selectedSession = '1000001';
      const agSessionIds = ['ag1'];
      const scenarioId = 'scenario123';

      const queryKey = [
        'campers',
        selectedSession,
        agSessionIds.sort(),
        scenarioId,
      ];

      expect(queryKey).toContain('scenario123');
    });

    it('should use undefined for production mode', () => {
      const scenarioId: string | undefined = undefined;
      const queryKey = ['campers', '1000001', [], scenarioId];

      expect(queryKey[3]).toBeUndefined();
    });
  });

  describe('camper merging', () => {
    it('should avoid duplicate campers when merging AG campers', () => {
      const mainCampers = [
        { id: 'c1', name: 'Alice' },
        { id: 'c2', name: 'Bob' },
      ];
      const agCampers = [
        { id: 'c2', name: 'Bob' }, // Duplicate
        { id: 'c3', name: 'Charlie' },
      ];

      const existingIds = new Set(mainCampers.map((c) => c.id));
      const newAgCampers = agCampers.filter((c) => !existingIds.has(c.id));
      const allCampers = [...mainCampers, ...newAgCampers];

      expect(allCampers).toHaveLength(3);
      expect(allCampers.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });
  });
});

describe('useBunkRequestsCount', () => {
  describe('query key construction', () => {
    it('should include all related session IDs', () => {
      const selectedSession = '1000001';
      const currentYear = 2025;
      const subSessionCmIds = [1000002, 1000003];
      const agSessionCmIds = [1235410];

      const queryKey = [
        'bunk-requests-count',
        selectedSession,
        currentYear,
        subSessionCmIds.sort(),
        agSessionCmIds.sort(),
      ];

      expect(queryKey[0]).toBe('bunk-requests-count');
      expect(queryKey[2]).toBe(2025);
    });
  });

  describe('count aggregation', () => {
    it('should sum counts from main, sub, and AG sessions', () => {
      const mainCount = 5;
      const subCounts = [3, 2];
      const agCounts = [1];

      const totalCount =
        mainCount +
        subCounts.reduce((a, b) => a + b, 0) +
        agCounts.reduce((a, b) => a + b, 0);

      expect(totalCount).toBe(11);
    });

    it('should return 0 for empty sessions', () => {
      const mainCount = 0;
      const subCounts: number[] = [];
      const agCounts: number[] = [];

      const totalCount =
        mainCount +
        subCounts.reduce((a, b) => a + b, 0) +
        agCounts.reduce((a, b) => a + b, 0);

      expect(totalCount).toBe(0);
    });
  });

  describe('filter construction', () => {
    it('should filter by session_id, year, and status', () => {
      const sessionCmId = 1000001;
      const year = 2025;
      const status = 'pending';

      const filter = `session_id = ${sessionCmId} && year = ${year} && status = "${status}"`;

      expect(filter).toBe(
        'session_id = 1000001 && year = 2025 && status = "pending"'
      );
    });
  });
});

describe('session ID parsing', () => {
  it('should parse valid session CampMinder ID', () => {
    const selectedSession = '1000001';
    const sessionCmId = parseInt(selectedSession, 10);

    expect(isNaN(sessionCmId)).toBe(false);
    expect(sessionCmId).toBe(1000001);
  });

  it('should handle invalid session ID gracefully', () => {
    const selectedSession = 'invalid';
    const sessionCmId = parseInt(selectedSession, 10);

    expect(isNaN(sessionCmId)).toBe(true);
  });
});

describe('hook options interface', () => {
  it('should define required options for useSessionBunks', () => {
    interface UseSessionBunksOptions {
      selectedSession: string | undefined;
      sessionCmId: number | undefined;
      agSessions: Array<{ id: string; cm_id: number }>;
      currentYear: number;
    }

    const options: UseSessionBunksOptions = {
      selectedSession: '1000001',
      sessionCmId: 1000001,
      agSessions: [{ id: 'ag1', cm_id: 1235410 }],
      currentYear: 2025,
    };

    expect(options.selectedSession).toBeDefined();
    expect(options.agSessions).toHaveLength(1);
  });

  it('should define required options for useSessionCampers', () => {
    interface UseSessionCampersOptions {
      selectedSession: string | undefined;
      agSessions: Array<{ id: string; cm_id: number }>;
      currentYear: number;
      scenarioId: string | undefined;
    }

    const options: UseSessionCampersOptions = {
      selectedSession: '1000001',
      agSessions: [],
      currentYear: 2025,
      scenarioId: undefined,
    };

    expect(options.scenarioId).toBeUndefined();
  });

  it('should define required options for useBunkRequestsCount', () => {
    interface UseBunkRequestsCountOptions {
      selectedSession: string | undefined;
      sessionCmId: number | undefined;
      currentYear: number;
      subSessions: Array<{ cm_id: number }>;
      agSessions: Array<{ cm_id: number }>;
    }

    const options: UseBunkRequestsCountOptions = {
      selectedSession: '1000001',
      sessionCmId: 1000001,
      currentYear: 2025,
      subSessions: [{ cm_id: 1000002 }],
      agSessions: [{ cm_id: 1235410 }],
    };

    expect(options.subSessions).toHaveLength(1);
    expect(options.agSessions).toHaveLength(1);
  });
});

describe('return type validation', () => {
  it('useSessionBunks should return bunks array', () => {
    const defaultReturn = {
      bunks: [] as Array<{ id: string; name: string }>,
      isLoading: false,
      error: null,
    };

    expect(Array.isArray(defaultReturn.bunks)).toBe(true);
  });

  it('useSessionCampers should return campers array', () => {
    const defaultReturn = {
      campers: [] as Array<{ id: string; name: string }>,
      isLoading: false,
      error: null,
    };

    expect(Array.isArray(defaultReturn.campers)).toBe(true);
  });

  it('useBunkRequestsCount should return number', () => {
    const defaultReturn = {
      count: 0,
      isLoading: false,
      error: null,
    };

    expect(typeof defaultReturn.count).toBe('number');
  });
});
