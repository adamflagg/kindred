/**
 * TDD tests for sessionTypePredicates.ts
 *
 * These tests are written FIRST (red phase) before any implementation.
 * They define the spec for the predicates module.
 */

import { describe, it, expect } from 'vitest'
import {
  isAtCampSession,
  isQuestSession,
  isInDropdown,
  isSummerCampSession,
  isTeenProgram,
  isEmbeddedSession,
  isMainSession,
  isAgSession,
  isMainOrEmbedded,
  isAgChildOf,
  isAtCampSessionType,
  isQuestSessionType,
  isInDropdownType,
  isSummerCampSessionType,
  isTeenProgramType,
  AT_CAMP_TYPES,
  DROPDOWN_TYPES,
  SUMMER_CAMP_TYPES,
  TEEN_PROGRAM_TYPES,
  QUEST_SESSION_TYPES,
  SESSION_TYPE_LITERALS,
  buildSummerSessionTypeFilter,
  getSummerWindow,
  isSummerTeenSession,
  CAMPER_JOURNEY_TYPES,
  CAMPER_DETAIL_TYPES,
  buildCamperJourneySessionTypeFilter,
  buildCamperDetailSessionTypeFilter,
} from '../sessionTypePredicates'
import type { Session } from '../../types/app-types'

// ============================================================================
// Helpers
// ============================================================================

function makeSession(session_type: string, overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-id',
    cm_id: 1001,
    name: 'Test Session',
    session_type,
    start_date: '2025-06-01',
    end_date: '2025-06-14',
    year: 2025,
    is_active: true,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Session
}

// All known session type literals — if a new one is added to pocketbase-types
// without updating this file, the test coverage will call it out.
// Note: 'taste' is NOT a session_type value — it's a name-match pattern.
const ALL_TYPES = [
  'main',
  'embedded',
  'ag',
  'quest',
  'tli',
  'teen',
  'family',
  'scit',
  'bmitzvah',
  'adult',
  'school',
  'hebrew',
  'other',
] as const
type AllType = (typeof ALL_TYPES)[number]

// ============================================================================
// Typed set exports
// ============================================================================

describe('typed set exports', () => {
  it('AT_CAMP_TYPES contains main, embedded, ag', () => {
    expect(AT_CAMP_TYPES).toContain('main')
    expect(AT_CAMP_TYPES).toContain('embedded')
    expect(AT_CAMP_TYPES).toContain('ag')
    expect(AT_CAMP_TYPES).not.toContain('quest')
    expect(AT_CAMP_TYPES).not.toContain('tli')
    expect(AT_CAMP_TYPES).not.toContain('teen')
  })

  it('DROPDOWN_TYPES contains main, embedded, quest', () => {
    expect(DROPDOWN_TYPES).toContain('main')
    expect(DROPDOWN_TYPES).toContain('embedded')
    expect(DROPDOWN_TYPES).toContain('quest')
    expect(DROPDOWN_TYPES).not.toContain('ag')
    expect(DROPDOWN_TYPES).not.toContain('tli')
    expect(DROPDOWN_TYPES).not.toContain('teen')
  })

  it('SUMMER_CAMP_TYPES contains main, embedded, ag, quest', () => {
    expect(SUMMER_CAMP_TYPES).toContain('main')
    expect(SUMMER_CAMP_TYPES).toContain('embedded')
    expect(SUMMER_CAMP_TYPES).toContain('ag')
    expect(SUMMER_CAMP_TYPES).toContain('quest')
    expect(SUMMER_CAMP_TYPES).not.toContain('tli')
    expect(SUMMER_CAMP_TYPES).not.toContain('teen')
  })

  it('TEEN_PROGRAM_TYPES contains scit, tli (not teen/winter)', () => {
    expect(TEEN_PROGRAM_TYPES).toContain('scit')
    expect(TEEN_PROGRAM_TYPES).toContain('tli')
    expect(TEEN_PROGRAM_TYPES).not.toContain('teen')
    expect(TEEN_PROGRAM_TYPES).not.toContain('main')
    expect(TEEN_PROGRAM_TYPES).not.toContain('quest')
  })

  it('SESSION_TYPE_LITERALS exports all known literals for exhaustiveness checks', () => {
    expect([...SESSION_TYPE_LITERALS].sort()).toEqual([...ALL_TYPES].sort())
    // 'taste' is NOT a session_type value — it's a name-match pattern
    expect(SESSION_TYPE_LITERALS).not.toContain('taste')
  })

  it('QUEST_SESSION_TYPES contains only quest', () => {
    expect(QUEST_SESSION_TYPES).toEqual(['quest'])
  })
})

// ============================================================================
// buildSummerSessionTypeFilter — PocketBase OR-clause builder
// ============================================================================

describe('buildSummerSessionTypeFilter', () => {
  it('builds an OR-clause over every summer camp session type', () => {
    const filter = buildSummerSessionTypeFilter()
    for (const t of SUMMER_CAMP_TYPES) {
      expect(filter).toContain(`session.session_type = "${t}"`)
    }
    // Joined with " || ", one clause per type — no trailing/leading separator
    expect(filter.split(' || ')).toHaveLength(SUMMER_CAMP_TYPES.length)
  })
})

// ============================================================================
// isAtCampSession — main | embedded | ag
// ============================================================================

describe('isAtCampSession', () => {
  const trueFor: AllType[] = ['main', 'embedded', 'ag']
  const falseFor: AllType[] = [
    'quest',
    'tli',
    'teen',
    'family',
    'scit',
    'bmitzvah',
    'adult',
    'school',
    'hebrew',
    'other',
  ]

  trueFor.forEach((t) => {
    it(`returns true for "${t}"`, () => {
      expect(isAtCampSession(makeSession(t))).toBe(true)
    })
  })

  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isAtCampSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isQuestSession — quest only
// ============================================================================

describe('isQuestSession', () => {
  it('returns true for "quest"', () => {
    expect(isQuestSession(makeSession('quest'))).toBe(true)
  })

  const falseFor: AllType[] = ['main', 'embedded', 'ag', 'tli', 'teen', 'family', 'scit']
  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isQuestSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isInDropdown — main | embedded | quest
// ============================================================================

describe('isInDropdown', () => {
  const trueFor: AllType[] = ['main', 'embedded', 'quest']
  const falseFor: AllType[] = [
    'ag',
    'tli',
    'teen',
    'family',
    'scit',
    'bmitzvah',
    'adult',
    'school',
    'hebrew',
    'other',
  ]

  trueFor.forEach((t) => {
    it(`returns true for "${t}"`, () => {
      expect(isInDropdown(makeSession(t))).toBe(true)
    })
  })

  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isInDropdown(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isSummerCampSession — main | embedded | ag | quest
// ============================================================================

describe('isSummerCampSession', () => {
  const trueFor: AllType[] = ['main', 'embedded', 'ag', 'quest']
  const falseFor: AllType[] = [
    'tli',
    'teen',
    'family',
    'scit',
    'bmitzvah',
    'adult',
    'school',
    'hebrew',
    'other',
  ]

  trueFor.forEach((t) => {
    it(`returns true for "${t}"`, () => {
      expect(isSummerCampSession(makeSession(t))).toBe(true)
    })
  })

  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isSummerCampSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isTeenProgram — scit | tli
// ============================================================================

describe('isTeenProgram', () => {
  const trueFor: AllType[] = ['scit', 'tli']
  const falseFor: AllType[] = ['main', 'embedded', 'ag', 'quest', 'family', 'teen']

  trueFor.forEach((t) => {
    it(`returns true for "${t}"`, () => {
      expect(isTeenProgram(makeSession(t))).toBe(true)
    })
  })

  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isTeenProgram(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isEmbeddedSession — embedded only
// ============================================================================

describe('isEmbeddedSession', () => {
  it('returns true for "embedded"', () => {
    expect(isEmbeddedSession(makeSession('embedded'))).toBe(true)
  })

  const falseFor: AllType[] = ['main', 'ag', 'quest', 'tli', 'teen', 'family']
  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isEmbeddedSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isMainSession — main only
// ============================================================================

describe('isMainSession', () => {
  it('returns true for "main"', () => {
    expect(isMainSession(makeSession('main'))).toBe(true)
  })

  const falseFor: AllType[] = ['embedded', 'ag', 'quest', 'tli', 'teen', 'family']
  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isMainSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isAgSession — ag only
// ============================================================================

describe('isAgSession', () => {
  it('returns true for "ag"', () => {
    expect(isAgSession(makeSession('ag'))).toBe(true)
  })

  const falseFor: AllType[] = ['main', 'embedded', 'quest', 'tli', 'teen', 'family']
  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isAgSession(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isMainOrEmbedded — main | embedded
// ============================================================================

describe('isMainOrEmbedded', () => {
  const trueFor: AllType[] = ['main', 'embedded']
  const falseFor: AllType[] = ['ag', 'quest', 'tli', 'teen', 'family', 'scit']

  trueFor.forEach((t) => {
    it(`returns true for "${t}"`, () => {
      expect(isMainOrEmbedded(makeSession(t))).toBe(true)
    })
  })

  falseFor.forEach((t) => {
    it(`returns false for "${t}"`, () => {
      expect(isMainOrEmbedded(makeSession(t))).toBe(false)
    })
  })
})

// ============================================================================
// isAgChildOf — child.parent_id === parent.cm_id && child.session_type === 'ag'
// ============================================================================

describe('isAgChildOf', () => {
  const parent = makeSession('main', { cm_id: 1000, id: 'parent-id' })
  const agChild = makeSession('ag', { cm_id: 1001, parent_id: 1000 })
  const embeddedChild = makeSession('embedded', { cm_id: 1002, parent_id: 1000 })
  const mainChild = makeSession('main', { cm_id: 1003, parent_id: 1000 })
  const agWrongParent = makeSession('ag', { cm_id: 1004, parent_id: 9999 })
  const agNoParent = makeSession('ag', { cm_id: 1005 })

  it('returns true when child is ag type and parent_id matches parent cm_id', () => {
    expect(isAgChildOf(agChild, parent)).toBe(true)
  })

  it('returns false when child is embedded (not ag)', () => {
    expect(isAgChildOf(embeddedChild, parent)).toBe(false)
  })

  it('returns false when child is main type', () => {
    expect(isAgChildOf(mainChild, parent)).toBe(false)
  })

  it('returns false when ag child has wrong parent_id', () => {
    expect(isAgChildOf(agWrongParent, parent)).toBe(false)
  })

  it('returns false when ag child has no parent_id', () => {
    expect(isAgChildOf(agNoParent, parent)).toBe(false)
  })
})

// ============================================================================
// String type predicates (operate on raw string, not Session object)
// ============================================================================

describe('isAtCampSessionType (string predicate)', () => {
  it('returns true for at-camp types', () => {
    expect(isAtCampSessionType('main')).toBe(true)
    expect(isAtCampSessionType('embedded')).toBe(true)
    expect(isAtCampSessionType('ag')).toBe(true)
  })
  it('returns false for non-at-camp types', () => {
    expect(isAtCampSessionType('quest')).toBe(false)
    expect(isAtCampSessionType('tli')).toBe(false)
    expect(isAtCampSessionType('')).toBe(false)
    expect(isAtCampSessionType(null)).toBe(false)
  })
})

describe('isQuestSessionType (string predicate)', () => {
  it('returns true for "quest"', () => expect(isQuestSessionType('quest')).toBe(true))
  it('returns false for "main"', () => expect(isQuestSessionType('main')).toBe(false))
})

describe('isInDropdownType (string predicate)', () => {
  it('returns true for "main"', () => expect(isInDropdownType('main')).toBe(true))
  it('returns true for "embedded"', () => expect(isInDropdownType('embedded')).toBe(true))
  it('returns true for "quest"', () => expect(isInDropdownType('quest')).toBe(true))
  it('returns false for "ag"', () => expect(isInDropdownType('ag')).toBe(false))
})

describe('isSummerCampSessionType (string predicate)', () => {
  it('returns true for "main"', () => expect(isSummerCampSessionType('main')).toBe(true))
  it('returns true for "ag"', () => expect(isSummerCampSessionType('ag')).toBe(true))
  it('returns false for "tli"', () => expect(isSummerCampSessionType('tli')).toBe(false))
})

describe('isTeenProgramType (string predicate)', () => {
  it('returns true for "scit"', () => expect(isTeenProgramType('scit')).toBe(true))
  it('returns true for "tli"', () => expect(isTeenProgramType('tli')).toBe(true))
  it('returns false for "teen"', () => expect(isTeenProgramType('teen')).toBe(false))
  it('returns false for "main"', () => expect(isTeenProgramType('main')).toBe(false))
})

// ============================================================================
// Exhaustiveness check
// Tests that every literal in SESSION_TYPE_LITERALS maps to at least one predicate.
// Adding a new type to the session schema without updating predicates should be
// caught by the TypeScript compiler via the assertNever pattern in the module.
// ============================================================================

describe('exhaustiveness: every known literal is covered by at least one predicate', () => {
  const coverageMap: Record<string, boolean> = {}

  for (const t of SESSION_TYPE_LITERALS) {
    const s = makeSession(t)
    const covered =
      isAtCampSession(s) ||
      isQuestSession(s) ||
      isTeenProgram(s) ||
      s.session_type === 'family' ||
      s.session_type === 'teen' ||
      s.session_type === 'bmitzvah' ||
      s.session_type === 'adult' ||
      s.session_type === 'school' ||
      s.session_type === 'hebrew' ||
      s.session_type === 'other'
    coverageMap[t] = covered
  }

  it('all literals in SESSION_TYPE_LITERALS are accounted for', () => {
    const uncovered = Object.entries(coverageMap)
      .filter(([, covered]) => !covered)
      .map(([t]) => t)
    expect(uncovered).toEqual([])
  })
})

// ============================================================================
// Teen cohort — summer-window helpers (mirror api/utils/session_metrics.py)
// ============================================================================

describe('teen cohort', () => {
  const sess = (session_type: string, start_date: string, end_date: string) =>
    ({ session_type, start_date, end_date }) as never

  it('TEEN_PROGRAM_TYPES is scit + tli (not teen/winter)', () => {
    expect(TEEN_PROGRAM_TYPES).toEqual(['scit', 'tli'])
  })

  it('getSummerWindow spans main sessions', () => {
    const window = getSummerWindow([
      sess('main', '2025-06-15', '2025-07-05'),
      sess('main', '2025-07-20', '2025-08-02'),
      sess('quest', '2025-09-01', '2025-09-05'),
    ])
    expect(window).toEqual(['2025-06-15', '2025-08-02'])
  })

  it('isSummerTeenSession includes summer scit/tli, excludes off-season', () => {
    const w: [string, string] = ['2025-06-15', '2025-08-02']
    expect(isSummerTeenSession(sess('scit', '2025-06-08', '2025-07-04'), w)).toBe(true)
    expect(isSummerTeenSession(sess('tli', '2025-07-11', '2025-08-03'), w)).toBe(true)
    expect(isSummerTeenSession(sess('scit', '2025-09-12', '2025-09-15'), w)).toBe(false) // fall
    expect(isSummerTeenSession(sess('tli', '2025-08-23', '2026-05-01'), w)).toBe(false) // interns
    expect(isSummerTeenSession(sess('main', '2025-06-15', '2025-07-05'), w)).toBe(false)
    expect(isSummerTeenSession(sess('scit', '2025-06-08', '2025-07-04'), null)).toBe(false)
  })
})

describe('camper journey/detail session-type sets', () => {
  it('CAMPER_JOURNEY_TYPES is summer + teen, no family (mirrors All Campers / metrics)', () => {
    expect(CAMPER_JOURNEY_TYPES).toEqual(['main', 'embedded', 'ag', 'quest', 'scit', 'tli'])
    expect(CAMPER_JOURNEY_TYPES).not.toContain('family')
  })

  it('CAMPER_DETAIL_TYPES is summer + teen, no family', () => {
    expect(CAMPER_DETAIL_TYPES).toEqual(['main', 'embedded', 'ag', 'quest', 'scit', 'tli'])
    expect(CAMPER_DETAIL_TYPES).not.toContain('family')
  })

  it('buildCamperJourneySessionTypeFilter ORs every journey type on session.session_type', () => {
    const f = buildCamperJourneySessionTypeFilter()
    for (const t of CAMPER_JOURNEY_TYPES) expect(f).toContain(`session.session_type = "${t}"`)
    expect(f).toContain('||')
    expect(f).not.toContain('"family"') // family is excluded from the journey
    expect(f.startsWith('(')).toBe(false) // caller wraps, matching buildSummerSessionTypeFilter
  })

  it('buildCamperDetailSessionTypeFilter includes teens and excludes family', () => {
    const f = buildCamperDetailSessionTypeFilter()
    expect(f).toContain('session.session_type = "scit"')
    expect(f).toContain('session.session_type = "tli"')
    expect(f).not.toContain('"family"')
  })
})
