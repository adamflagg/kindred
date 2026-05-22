import { describe, it, expect } from 'vitest'
import {
  filterSummerCampBunks,
  getDropdownSessions,
  getSessionRelationshipsForCamperView,
  getCampersHeadlineNoun,
  splitDropdownSessionsByType,
  resolveScopedSessions,
  FILTER_ALL,
  FILTER_AT_CAMP,
  FILTER_QUESTS,
  FILTER_TEENS,
  type SessionWithType,
} from './allCampersUtils'
import type { BunksResponse, BunkPlansResponse } from '../types/pocketbase-types'
import type { Session } from '../types/app-types'
import { expectDefined } from '../test/testUtils'

// Mock data helper — cast partial session objects as Session
let mockSessionCounter = 1000

function createMockSession(overrides: {
  name: string
  session_type: string
  [key: string]: unknown
}): Session {
  const id =
    typeof overrides['id'] === 'string'
      ? overrides['id']
      : `session-${overrides.name.replace(/\s/g, '-').toLowerCase()}`
  return {
    id,
    cm_id: ++mockSessionCounter,
    year: 2025,
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    created: '',
    updated: '',
    ...overrides,
  } as Session
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
    cm_id: Math.floor(Math.random() * 10000),
  } as BunksResponse
}

function createMockBunkPlan(
  bunkId: string,
  sessionId: string,
  year: number = 2025
): BunkPlansResponse {
  return {
    id: `bp-${bunkId}-${sessionId}`,
    collectionId: 'bunk_plans',
    collectionName: 'bunk_plans',
    created: '',
    updated: '',
    bunk: bunkId,
    session: sessionId,
    year,
  } as BunkPlansResponse
}

describe('allCampersUtils', () => {
  describe('filterSummerCampBunks', () => {
    it('should include bunks linked to main sessions', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
        }),
      ]
      const bunks = [createMockBunk('B-1'), createMockBunk('B-2')]
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'main-2'),
      ]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(2)
      expect(result.map((b: BunksResponse) => b.name)).toContain('B-1')
      expect(result.map((b: BunksResponse) => b.name)).toContain('B-2')
    })

    it('should include bunks linked to AG sessions', () => {
      const sessions = [
        createMockSession({
          name: 'All-Gender Session 2',
          session_type: 'ag',
          id: 'ag-2',
        }),
      ]
      const bunks = [createMockBunk('AG-8', 'Mixed')]
      const bunkPlans = [createMockBunkPlan(expectDefined(bunks[0]).id, 'ag-2')]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('AG-8')
    })

    it('should include bunks linked to embedded sessions', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          id: 'emb-2a',
        }),
      ]
      const bunks = [createMockBunk('B-1'), createMockBunk('G-1', 'F')]
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'emb-2a'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'emb-2a'),
      ]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(2)
    })

    it('should EXCLUDE bunks only linked to family camp sessions', () => {
      const sessions = [
        createMockSession({
          name: 'Family Camp 1',
          session_type: 'family',
          id: 'fam-1',
        }),
      ]
      const bunks = [createMockBunk('Acorns (with parents)'), createMockBunk('Azaleas')]
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'fam-1'),
        createMockBunkPlan(expectDefined(bunks[1]).id, 'fam-1'),
      ]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(0)
    })

    it('should include bunks linked to both family AND main sessions', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
        }),
        createMockSession({
          name: 'Family Camp 1',
          session_type: 'family',
          id: 'fam-1',
        }),
      ]
      // This bunk is used in both summer and family camp
      const bunks = [createMockBunk('B-1')]
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2'),
        createMockBunkPlan(expectDefined(bunks[0]).id, 'fam-1'),
      ]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('B-1')
    })

    it('should exclude bunks with no bunk_plans at all', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
        }),
      ]
      const bunks = [
        createMockBunk('B-1'),
        createMockBunk('Orphan-Bunk'), // No bunk_plan
      ]
      const bunkPlans = [
        createMockBunkPlan(expectDefined(bunks[0]).id, 'main-2'),
        // No plan for Orphan-Bunk
      ]

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('B-1')
    })

    it('should sort bunks by name (B-*, G-*, AG-* ordering)', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
        }),
        createMockSession({
          name: 'All-Gender Session 2',
          session_type: 'ag',
          id: 'ag-2',
        }),
      ]
      const bunks = [
        createMockBunk('G-1', 'F'),
        createMockBunk('AG-8', 'Mixed'),
        createMockBunk('B-2'),
        createMockBunk('B-1'),
        createMockBunk('G-2', 'F'),
      ]
      const bunkPlans = bunks.map((b: BunksResponse) =>
        createMockBunkPlan(b.id, b.gender === 'Mixed' ? 'ag-2' : 'main-2')
      )

      const result = filterSummerCampBunks(bunks, bunkPlans, sessions)
      expect(result.map((b: BunksResponse) => b.name)).toEqual(['AG-8', 'B-1', 'B-2', 'G-1', 'G-2'])
    })
  })

  describe('getDropdownSessions', () => {
    it('should include main sessions', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          cm_id: 200,
        }),
        createMockSession({
          name: 'Session 3',
          session_type: 'main',
          cm_id: 300,
        }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(2)
      expect(result.map((s: Session) => s.name)).toContain('Session 2')
      expect(result.map((s: Session) => s.name)).toContain('Session 3')
    })

    it('should include embedded sessions as independent entries', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          cm_id: 200,
          start_date: '2025-06-01',
          end_date: '2025-06-14',
        }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          cm_id: 210,
          start_date: '2025-06-01',
          end_date: '2025-06-07',
        }),
        createMockSession({
          name: 'Session 2b',
          session_type: 'embedded',
          cm_id: 211,
          start_date: '2025-06-08',
          end_date: '2025-06-14',
        }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(3)
      expect(result.map((s: Session) => s.name)).toContain('Session 2')
      expect(result.map((s: Session) => s.name)).toContain('Session 2a')
      expect(result.map((s: Session) => s.name)).toContain('Session 2b')
    })

    it('should EXCLUDE AG sessions from dropdown (they are grouped with parent)', () => {
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          cm_id: 200,
        }),
        createMockSession({
          name: 'All-Gender Session 2',
          session_type: 'ag',
          cm_id: 201,
          parent_id: 200,
        }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Session 2')
    })

    it('should include Taste of Camp (which is a main session)', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Taste of Camp', session_type: 'main' }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(2)
      expect(result.map((s: Session) => s.name)).toContain('Taste of Camp')
    })

    it('should EXCLUDE family camp sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Family Camp 1', session_type: 'family' }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Session 2')
    })

    it('should sort sessions by start_date', () => {
      const sessions = [
        createMockSession({
          name: 'Session 3',
          session_type: 'main',
          start_date: '2025-06-15',
        }),
        createMockSession({
          name: 'Taste of Camp',
          session_type: 'main',
          start_date: '2025-05-25',
        }),
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          start_date: '2025-06-01',
        }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          start_date: '2025-06-01',
        }),
      ]

      const result = getDropdownSessions(sessions)
      expect(result.map((s: Session) => s.name)).toEqual([
        'Taste of Camp',
        'Session 2',
        'Session 2a',
        'Session 3',
      ])
    })
  })

  describe('getSessionRelationshipsForCamperView', () => {
    it('should group AG sessions with their parent main session', () => {
      const sessions: SessionWithType[] = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
          cm_id: 200,
        }),
        createMockSession({
          name: 'All-Gender Session 2',
          session_type: 'ag',
          id: 'ag-2',
          cm_id: 201,
          parent_id: 200,
        }),
      ]

      const relationships = getSessionRelationshipsForCamperView(sessions)

      // Main session should include itself and AG session
      expect(relationships.get('main-2')).toContain('main-2')
      expect(relationships.get('main-2')).toContain('ag-2')
    })

    it('should NOT group embedded sessions with main sessions', () => {
      const sessions: SessionWithType[] = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
          cm_id: 200,
          start_date: '2025-06-01',
          end_date: '2025-06-14',
        }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          id: 'emb-2a',
          cm_id: 210,
          start_date: '2025-06-01',
          end_date: '2025-06-07',
        }),
      ]

      const relationships = getSessionRelationshipsForCamperView(sessions)

      // Main session should only include itself
      expect(relationships.get('main-2')).toEqual(['main-2'])

      // Embedded session should be its own entry (not grouped with main)
      expect(relationships.get('emb-2a')).toEqual(['emb-2a'])
    })

    it('should keep each embedded session independent', () => {
      const sessions: SessionWithType[] = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          id: 'main-2',
          cm_id: 200,
        }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          id: 'emb-2a',
          cm_id: 210,
        }),
        createMockSession({
          name: 'Session 2b',
          session_type: 'embedded',
          id: 'emb-2b',
          cm_id: 211,
        }),
      ]

      const relationships = getSessionRelationshipsForCamperView(sessions)

      // Each embedded session should be independent
      expect(relationships.get('emb-2a')).toEqual(['emb-2a'])
      expect(relationships.get('emb-2b')).toEqual(['emb-2b'])

      // Main session should NOT include embedded sessions
      expect(relationships.get('main-2')).toEqual(['main-2'])
    })

    it('should handle AG sessions linking to main via parent_id', () => {
      const sessions: SessionWithType[] = [
        createMockSession({
          name: 'Session 3',
          session_type: 'main',
          id: 'main-3',
          cm_id: 300,
        }),
        createMockSession({
          name: 'AG Session 3 (7th-8th)',
          session_type: 'ag',
          id: 'ag-3a',
          cm_id: 301,
          parent_id: 300,
        }),
        createMockSession({
          name: 'AG Session 3 (9th-10th)',
          session_type: 'ag',
          id: 'ag-3b',
          cm_id: 302,
          parent_id: 300,
        }),
      ]

      const relationships = getSessionRelationshipsForCamperView(sessions)

      // Main session should include itself and both AG sessions
      const mainRelated = relationships.get('main-3')
      expect(mainRelated).toContain('main-3')
      expect(mainRelated).toContain('ag-3a')
      expect(mainRelated).toContain('ag-3b')
    })
  })

  // ── #6: Teen-program inclusion (window-gated) ────────────────────────────
  describe('getDropdownSessions — teen program inclusion (#6)', () => {
    it('should INCLUDE summer-window-overlapping tli sessions in the picker', () => {
      // Both sessions share the same default dates → tli overlaps the window
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli' }),
      ]
      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(2)
      expect(result.map((s: Session) => s.name)).toContain('Session 2')
      expect(result.map((s: Session) => s.name)).toContain('TLI: Rising 11th')
    })

    it('should INCLUDE summer-window-overlapping scit sessions in the picker', () => {
      const sessions = [
        createMockSession({ name: 'Session 3', session_type: 'main' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit' }),
      ]
      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(2)
      expect(result.map((s: Session) => s.name)).toContain('Session 3')
      expect(result.map((s: Session) => s.name)).toContain('SCIT: Rising 12th')
    })

    it('should EXCLUDE off-season teen sessions (no window overlap)', () => {
      // off-season tli has dates that don't overlap the main-session window
      const sessions = [
        createMockSession({
          name: 'Session 2',
          session_type: 'main',
          start_date: '2025-06-01',
          end_date: '2025-06-14',
        }),
        createMockSession({
          name: 'TLI: Fall Program',
          session_type: 'tli',
          start_date: '2025-09-01',
          end_date: '2025-09-14',
        }),
      ]
      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Session 2')
    })

    it('should EXCLUDE legacy "teen" session_type (not in TEEN_PROGRAM_TYPES)', () => {
      // session_type 'teen' is not the same as 'scit' or 'tli'
      const sessions = [
        createMockSession({ name: 'Session 3', session_type: 'main' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'teen' }),
      ]
      const result = getDropdownSessions(sessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Session 3')
    })

    it('should include quest sessions alongside summer teen sessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit' }),
        createMockSession({ name: 'Legacy Teen', session_type: 'teen' }),
      ]
      const result = getDropdownSessions(sessions)
      // main + quest + tli + scit (4); 'teen' type excluded
      expect(result).toHaveLength(4)
      expect(result.map((s: Session) => s.name)).toContain('Session 2')
      expect(result.map((s: Session) => s.name)).toContain('Quest: Pacific Crest')
      expect(result.map((s: Session) => s.name)).toContain('TLI: Rising 11th')
      expect(result.map((s: Session) => s.name)).toContain('SCIT: Rising 12th')
      expect(result.map((s: Session) => s.name)).not.toContain('Legacy Teen')
    })
  })

  // ── FILTER_TEENS constant ─────────────────────────────────────────────────
  describe('FILTER_TEENS constant', () => {
    it('equals the string "teens"', () => {
      expect(FILTER_TEENS).toBe('teens')
    })
  })

  // ── resolveScopedSessions with FILTER_TEENS ───────────────────────────────
  describe('resolveScopedSessions — FILTER_TEENS', () => {
    const mainSession = createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' })
    const questSession = createMockSession({
      name: 'Quest: Pacific Crest',
      session_type: 'quest',
      id: 'quest-1',
    })
    const scitSession = createMockSession({
      name: 'SCIT: Rising 12th',
      session_type: 'scit',
      id: 'scit-1',
    })
    const tliSession = createMockSession({
      name: 'TLI: Rising 11th',
      session_type: 'tli',
      id: 'tli-1',
    })
    const allSessions = [mainSession, questSession, scitSession, tliSession]

    it(`'${FILTER_TEENS}' returns only teen sessions`, () => {
      const result = resolveScopedSessions(FILTER_TEENS, allSessions)
      expect(result).toHaveLength(2)
      expect(result.map((s) => s.id)).toContain('scit-1')
      expect(result.map((s) => s.id)).toContain('tli-1')
    })

    it(`'${FILTER_TEENS}' returns empty array when no teen sessions present`, () => {
      const result = resolveScopedSessions(FILTER_TEENS, [mainSession, questSession])
      expect(result).toEqual([])
    })
  })

  // ── getSessionRelationshipsForCamperView — teen sessions ──────────────────
  describe('getSessionRelationshipsForCamperView — teen sessions', () => {
    it('teen sessions map to themselves (independent self-entry)', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit', id: 'scit-1' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli', id: 'tli-1' }),
      ]
      const relationships = getSessionRelationshipsForCamperView(sessions)
      expect(relationships.get('scit-1')).toEqual(['scit-1'])
      expect(relationships.get('tli-1')).toEqual(['tli-1'])
    })

    it('teen sessions are independent of main sessions', () => {
      const sessions: SessionWithType[] = [
        createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit', id: 'scit-1' }),
      ]
      const relationships = getSessionRelationshipsForCamperView(sessions)
      expect(relationships.get('main-2')).toEqual(['main-2'])
      expect(relationships.get('scit-1')).toEqual(['scit-1'])
    })
  })

  // ── splitDropdownSessionsByType ────────────────────────────────────────────
  describe('splitDropdownSessionsByType', () => {
    it('main and embedded sessions go to campSessions; quest to questSessions', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main', start_date: '2025-06-01' }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          start_date: '2025-06-01',
        }),
        createMockSession({
          name: 'Quest: Pacific Crest',
          session_type: 'quest',
          start_date: '2025-07-01',
        }),
      ]
      const { campSessions, questSessions } = splitDropdownSessionsByType(sessions)
      expect(campSessions).toHaveLength(2)
      expect(campSessions.map((s) => s.name)).toContain('Session 2')
      expect(campSessions.map((s) => s.name)).toContain('Session 2a')
      expect(questSessions).toHaveLength(1)
      expect(questSessions[0]?.name).toBe('Quest: Pacific Crest')
    })

    it('campSessions are sorted by start_date', () => {
      const sessions = [
        createMockSession({ name: 'Session 3', session_type: 'main', start_date: '2025-07-15' }),
        createMockSession({ name: 'Session 2', session_type: 'main', start_date: '2025-06-01' }),
        createMockSession({
          name: 'Session 2a',
          session_type: 'embedded',
          start_date: '2025-06-01',
        }),
      ]
      const { campSessions } = splitDropdownSessionsByType(sessions)
      expect(campSessions[0]?.start_date).toBe('2025-06-01')
      expect(campSessions[campSessions.length - 1]?.start_date).toBe('2025-07-15')
    })

    it('questSessions are sorted by start_date', () => {
      const sessions = [
        createMockSession({
          name: 'Quest: Adirondacks',
          session_type: 'quest',
          start_date: '2025-08-01',
        }),
        createMockSession({
          name: 'Quest: Pacific Crest',
          session_type: 'quest',
          start_date: '2025-07-01',
        }),
      ]
      const { questSessions } = splitDropdownSessionsByType(sessions)
      expect(questSessions[0]?.name).toBe('Quest: Pacific Crest')
      expect(questSessions[1]?.name).toBe('Quest: Adirondacks')
    })

    it('empty input returns empty arrays', () => {
      const { campSessions, questSessions } = splitDropdownSessionsByType([])
      expect(campSessions).toEqual([])
      expect(questSessions).toEqual([])
    })
  })

  // ── resolveScopedSessions ─────────────────────────────────────────────────
  describe('resolveScopedSessions', () => {
    const mainSession = createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' })
    const embeddedSession = createMockSession({
      name: 'Session 2a',
      session_type: 'embedded',
      id: 'emb-2a',
    })
    const questSession = createMockSession({
      name: 'Quest: Pacific Crest',
      session_type: 'quest',
      id: 'quest-1',
    })
    const allSessions = [mainSession, embeddedSession, questSession]

    it(`'${FILTER_ALL}' returns the full input list`, () => {
      expect(resolveScopedSessions(FILTER_ALL, allSessions)).toEqual(allSessions)
    })

    it(`'${FILTER_AT_CAMP}' returns only main + embedded sessions`, () => {
      const result = resolveScopedSessions(FILTER_AT_CAMP, allSessions)
      expect(result).toHaveLength(2)
      expect(result.map((s) => s.session_type)).not.toContain('quest')
    })

    it(`'${FILTER_QUESTS}' returns only quest sessions`, () => {
      const result = resolveScopedSessions(FILTER_QUESTS, allSessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('quest-1')
    })

    it('specific session ID returns array with just that session', () => {
      const result = resolveScopedSessions('emb-2a', allSessions)
      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('emb-2a')
    })

    it('unknown session ID returns empty array', () => {
      const result = resolveScopedSessions('nonexistent-id', allSessions)
      expect(result).toEqual([])
    })
  })

  // ── Composition: resolveScopedSessions → getCampersHeadlineNoun ───────────
  it('resolveScopedSessions pipes into getCampersHeadlineNoun correctly', () => {
    const mainSession = createMockSession({ name: 'Session 2', session_type: 'main', id: 'main-2' })
    const questSession = createMockSession({
      name: 'Quest: Pacific Crest',
      session_type: 'quest',
      id: 'quest-1',
    })
    const sessions = [mainSession, questSession]

    const atCamp = resolveScopedSessions(FILTER_AT_CAMP, sessions)
    expect(getCampersHeadlineNoun(atCamp, 1)).toBe('camper')
    expect(getCampersHeadlineNoun(atCamp, 5)).toBe('campers')

    const quests = resolveScopedSessions(FILTER_QUESTS, sessions)
    expect(getCampersHeadlineNoun(quests, 1)).toBe('quester')
    expect(getCampersHeadlineNoun(quests, 5)).toBe('questers')

    const all = resolveScopedSessions(FILTER_ALL, sessions)
    expect(getCampersHeadlineNoun(all, 5)).toBe('campers and questers')
  })

  // ── #5: Headline noun swap ────────────────────────────────────────────────
  describe('getCampersHeadlineNoun (#5)', () => {
    it('returns "camper"/"campers" when only at-camp sessions are selected', () => {
      const atCampSessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Session 2a', session_type: 'embedded' }),
      ]
      expect(getCampersHeadlineNoun(atCampSessions, 1)).toBe('camper')
      expect(getCampersHeadlineNoun(atCampSessions, 5)).toBe('campers')
    })

    it('returns "quester"/"questers" when only quest sessions are selected', () => {
      const questSessions = [
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
        createMockSession({ name: 'Quest: Adirondacks', session_type: 'quest' }),
      ]
      expect(getCampersHeadlineNoun(questSessions, 1)).toBe('quester')
      expect(getCampersHeadlineNoun(questSessions, 3)).toBe('questers')
    })

    it('returns "camper(s) and quester(s)" when mixed at-camp + quest sessions', () => {
      const mixedSessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
      ]
      expect(getCampersHeadlineNoun(mixedSessions, 1)).toBe('camper and quester')
      expect(getCampersHeadlineNoun(mixedSessions, 7)).toBe('campers and questers')
    })

    it('returns "campers and questers" when all sessions include both at-camp and quest types', () => {
      // When allSessions contains both types and nothing is filtered, treat as "mixed"
      // but the "all sessions" case means the noun is based on what's visible
      // Empty selectedSessions means "all" — which is at-camp + quest → mixed
      const allSessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
      ]
      expect(getCampersHeadlineNoun(allSessions, 10)).toBe('campers and questers')
    })

    it('ag sessions count as at-camp for noun purposes', () => {
      const agSessions = [createMockSession({ name: 'AG Session 2', session_type: 'ag' })]
      expect(getCampersHeadlineNoun(agSessions, 4)).toBe('campers')
    })

    it('embedded sessions count as at-camp for noun purposes', () => {
      const embeddedSessions = [createMockSession({ name: 'Session 2a', session_type: 'embedded' })]
      expect(getCampersHeadlineNoun(embeddedSessions, 2)).toBe('campers')
    })
  })

  // ── getCampersHeadlineNoun — teens (#10) ──────────────────────────────────
  describe('getCampersHeadlineNoun — teens (#10)', () => {
    it('returns "teen"/"teens" when only teen sessions are selected', () => {
      const teenSessions = [
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli' }),
      ]
      expect(getCampersHeadlineNoun(teenSessions, 1)).toBe('teen')
      expect(getCampersHeadlineNoun(teenSessions, 5)).toBe('teens')
    })

    it('returns "campers and teens" when at-camp + teen only', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit' }),
      ]
      expect(getCampersHeadlineNoun(sessions, 1)).toBe('camper and teen')
      expect(getCampersHeadlineNoun(sessions, 5)).toBe('campers and teens')
    })

    it('returns "questers and teens" when quest + teen only', () => {
      const sessions = [
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli' }),
      ]
      expect(getCampersHeadlineNoun(sessions, 5)).toBe('questers and teens')
    })

    it('returns "campers, questers, and teens" when all three cohorts present', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
        createMockSession({ name: 'SCIT: Rising 12th', session_type: 'scit' }),
      ]
      expect(getCampersHeadlineNoun(sessions, 5)).toBe('campers, questers, and teens')
    })

    it('singular "camper, quester, and teen" for count=1 all three cohorts', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
        createMockSession({ name: 'TLI: Rising 11th', session_type: 'tli' }),
      ]
      expect(getCampersHeadlineNoun(sessions, 1)).toBe('camper, quester, and teen')
    })

    it('no-teen fixtures remain unchanged (at-camp only)', () => {
      const atCampSessions = [createMockSession({ name: 'Session 2', session_type: 'main' })]
      expect(getCampersHeadlineNoun(atCampSessions, 5)).toBe('campers')
    })

    it('no-teen fixtures remain unchanged (quest only)', () => {
      const questSessions = [
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
      ]
      expect(getCampersHeadlineNoun(questSessions, 5)).toBe('questers')
    })

    it('no-teen fixtures remain unchanged (at-camp + quest)', () => {
      const sessions = [
        createMockSession({ name: 'Session 2', session_type: 'main' }),
        createMockSession({ name: 'Quest: Pacific Crest', session_type: 'quest' }),
      ]
      expect(getCampersHeadlineNoun(sessions, 5)).toBe('campers and questers')
    })
  })
})
