/**
 * Tests for useSessionHierarchy hook
 * Following TDD - tests written first, implementation follows
 */

import { describe, it, expect } from 'vitest';
import { getSubSessions, getAgSessions, shouldShowAgArea } from './useSessionHierarchy';
import type { Session } from '../../types/app-types';

// Mock sessions for testing
const createMockSession = (
  id: string,
  name: string,
  cmId: number,
  sessionType: 'main' | 'embedded' | 'ag' = 'main',
  parentId?: number
): Session => {
  const baseSession = {
    id,
    name,
    cm_id: cmId,
    session_type: sessionType,
    year: 2025,
    collectionId: 'sessions',
    collectionName: 'camp_sessions',
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  // Only include parent_id if defined (for exactOptionalPropertyTypes)
  if (parentId !== undefined) {
    return { ...baseSession, parent_id: parentId };
  }
  return baseSession;
};

describe('getSubSessions', () => {
  it('should return empty array when parent session is null', () => {
    const allSessions: Session[] = [];
    const result = getSubSessions(null, allSessions, {}, true);
    expect(result).toEqual([]);
  });

  it('should find embedded sessions by parent_id relationship', () => {
    const parentSession = createMockSession('s1', 'Session 2', 1001, 'main');
    const embeddedA = createMockSession('s2', 'Session 2a', 1002, 'embedded', 1001);
    const embeddedB = createMockSession('s3', 'Session 2b', 1003, 'embedded', 1001);
    const unrelated = createMockSession('s4', 'Session 3', 1004, 'main');

    const allSessions = [parentSession, embeddedA, embeddedB, unrelated];
    const result = getSubSessions(parentSession, allSessions, {}, false);

    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['Session 2a', 'Session 2b']);
  });

  it('should fallback to name matching when parent_id not set (legacy data)', () => {
    const parentSession = createMockSession('s1', 'Session 2', 1001, 'main');
    // Legacy embedded sessions without parent_id
    const embeddedA = createMockSession('s2', 'Session 2a', 1002, 'main', undefined);
    const embeddedB = createMockSession('s3', 'Session 2b', 1003, 'main', undefined);

    const allSessions = [parentSession, embeddedA, embeddedB];
    const result = getSubSessions(parentSession, allSessions, {}, false);

    expect(result).toHaveLength(2);
    expect(result.map((s: Session) => s.name)).toContain('Session 2a');
    expect(result.map((s: Session) => s.name)).toContain('Session 2b');
  });

  it('should filter out sessions with zero bunk plans', () => {
    const parentSession = createMockSession('s1', 'Session 2', 1001, 'main');
    const embeddedA = createMockSession('s2', 'Session 2a', 1002, 'embedded', 1001);
    const embeddedB = createMockSession('s3', 'Session 2b', 1003, 'embedded', 1001);

    const allSessions = [parentSession, embeddedA, embeddedB];
    const bunkPlanCounts = { 's2': 5, 's3': 0 }; // 2b has no bunk plans

    const result = getSubSessions(parentSession, allSessions, bunkPlanCounts, true);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Session 2a');
  });

  it('should include all sessions when bunk plan counts not yet loaded', () => {
    const parentSession = createMockSession('s1', 'Session 2', 1001, 'main');
    const embeddedA = createMockSession('s2', 'Session 2a', 1002, 'embedded', 1001);
    const embeddedB = createMockSession('s3', 'Session 2b', 1003, 'embedded', 1001);

    const allSessions = [parentSession, embeddedA, embeddedB];
    // Counts not yet loaded
    const result = getSubSessions(parentSession, allSessions, {}, false);

    expect(result).toHaveLength(2);
  });

  it('should sort sub-sessions alphabetically', () => {
    const parentSession = createMockSession('s1', 'Session 2', 1001, 'main');
    const embeddedB = createMockSession('s3', 'Session 2b', 1003, 'embedded', 1001);
    const embeddedA = createMockSession('s2', 'Session 2a', 1002, 'embedded', 1001);

    const allSessions = [parentSession, embeddedB, embeddedA]; // Out of order
    const result = getSubSessions(parentSession, allSessions, {}, false);

    expect(result[0]?.name).toBe('Session 2a');
    expect(result[1]?.name).toBe('Session 2b');
  });
});

describe('getAgSessions', () => {
  it('should return empty array when parent session is null', () => {
    const allSessions: Session[] = [];
    const result = getAgSessions(null, allSessions, {}, true);
    expect(result).toEqual([]);
  });

  it('should find AG sessions by parent_id and session_type', () => {
    const parentSession = createMockSession('s1', 'Session 1', 1001, 'main');
    const agSession = createMockSession('s2', 'Session 1 All-Gender', 1002, 'ag', 1001);
    const unrelated = createMockSession('s3', 'Session 2', 1003, 'main');

    const allSessions = [parentSession, agSession, unrelated];
    const result = getAgSessions(parentSession, allSessions, {}, false);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Session 1 All-Gender');
  });

  it('should fallback to name matching when parent_id not set', () => {
    const parentSession = createMockSession('s1', 'Session 1', 1001, 'main');
    // Legacy AG session without proper parent_id
    const agSession = createMockSession('s2', 'Session 1 All-Gender', 1002, 'main', undefined);

    const allSessions = [parentSession, agSession];
    const result = getAgSessions(parentSession, allSessions, {}, false);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toContain('All-Gender');
  });

  it('should filter out AG sessions with zero bunk plans', () => {
    const parentSession = createMockSession('s1', 'Session 1', 1001, 'main');
    const agSession1 = createMockSession('s2', 'Session 1 AG', 1002, 'ag', 1001);
    const agSession2 = createMockSession('s3', 'Session 1 AG Extra', 1003, 'ag', 1001);

    const allSessions = [parentSession, agSession1, agSession2];
    const bunkPlanCounts = { 's2': 3, 's3': 0 }; // Second AG session has no plans

    const result = getAgSessions(parentSession, allSessions, bunkPlanCounts, true);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Session 1 AG');
  });
});

describe('shouldShowAgArea', () => {
  it('should return false when no AG sessions exist', () => {
    expect(shouldShowAgArea([], true)).toBe(false);
  });

  it('should return false when viewing embedded session', () => {
    const agSession = createMockSession('s1', 'Session 1 AG', 1002, 'ag', 1001);
    expect(shouldShowAgArea([agSession], false)).toBe(false);
  });

  it('should return true when AG sessions exist and viewing main session', () => {
    const agSession = createMockSession('s1', 'Session 1 AG', 1002, 'ag', 1001);
    expect(shouldShowAgArea([agSession], true)).toBe(true);
  });
});
