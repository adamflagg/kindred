/**
 * TDD tests for populate-from-previous-year utility functions.
 * Written FIRST before implementation.
 *
 * Tests cover:
 * - Session matching across years (3-pass algorithm)
 * - Date shifting by one year
 * - Preview building from matched sessions and config
 */

import { describe, it, expect } from 'vitest'
import {
  matchSessions,
  shiftDateByOneYear,
  buildPreview,
  isEmptyValue,
  type SessionMatch,
  type SessionData,
  type ConfigRecordLike,
} from './populateUtils'

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(cm_id: number, name: string, session_type: string, year: number): SessionData {
  return { cm_id, name, session_type, year }
}

function makeConfig(
  category: string,
  subcategory: string,
  config_key: string,
  value: unknown,
  id = `cfg_${config_key}_${subcategory}`
): ConfigRecordLike {
  return { id, category, subcategory, config_key, value }
}

// ── matchSessions ────────────────────────────────────────────────────

describe('matchSessions', () => {
  it('matches sessions by cm_id (pass 1)', () => {
    const current = [makeSession(1001, 'Session 1', 'main', 2026)]
    const previous = [makeSession(1001, 'Session 1', 'main', 2025)]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('cm_id')
    expect(result[0]!.currentSession.cm_id).toBe(1001)
    expect(result[0]!.previousSession!.cm_id).toBe(1001)
  })

  it('matches sessions by canonical name + type (pass 2) when cm_ids differ', () => {
    const current = [makeSession(2001, 'Session 2', 'main', 2026)]
    const previous = [makeSession(9999, 'Session 2', 'main', 2025)]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('alias')
    expect(result[0]!.currentSession.cm_id).toBe(2001)
    expect(result[0]!.previousSession!.cm_id).toBe(9999)
  })

  it('matches renamed sessions via alias resolution (pass 2)', () => {
    // "Taste of Camp" (2025) → alias resolves to "Taste of Camp 1"
    // "Taste of Camp 1" (2026) → already canonical
    const current = [makeSession(3001, 'Taste of Camp 1', 'main', 2026)]
    const previous = [makeSession(5001, 'Taste of Camp', 'main', 2025)]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('alias')
    expect(result[0]!.currentSession.cm_id).toBe(3001)
    expect(result[0]!.previousSession!.cm_id).toBe(5001)
  })

  it('marks new sessions as unmatched', () => {
    const current = [
      makeSession(1001, 'Session 1', 'main', 2026),
      makeSession(9001, 'Brand New Session', 'main', 2026),
    ]
    const previous = [makeSession(1001, 'Session 1', 'main', 2025)]

    const result = matchSessions(current, previous)

    const matched = result.filter((m) => m.matchType !== 'unmatched')
    const unmatched = result.filter((m) => m.matchType === 'unmatched')

    expect(matched).toHaveLength(1)
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0]!.currentSession.name).toBe('Brand New Session')
    expect(unmatched[0]!.previousSession).toBeNull()
  })

  it('does not match sessions of different types even if names match', () => {
    const current = [makeSession(1001, 'Session 2', 'ag', 2026)]
    const previous = [makeSession(9999, 'Session 2', 'main', 2025)]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('unmatched')
  })

  it('handles empty current sessions', () => {
    const result = matchSessions([], [makeSession(1001, 'Session 1', 'main', 2025)])
    expect(result).toHaveLength(0)
  })

  it('handles empty previous sessions', () => {
    const current = [makeSession(1001, 'Session 1', 'main', 2026)]
    const result = matchSessions(current, [])

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('unmatched')
  })

  it('prefers cm_id match over alias match', () => {
    // Same cm_id but different names — cm_id should win
    const current = [makeSession(1001, 'Renamed Session', 'main', 2026)]
    const previous = [makeSession(1001, 'Session 1', 'main', 2025)]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(1)
    expect(result[0]!.matchType).toBe('cm_id')
  })

  it('matches multiple sessions correctly', () => {
    const current = [
      makeSession(1001, 'Session 1', 'main', 2026),
      makeSession(1002, 'Session 2', 'main', 2026),
      makeSession(1003, 'Session 2a', 'embedded', 2026),
      makeSession(2001, 'AG Session 2', 'ag', 2026),
    ]
    const previous = [
      makeSession(1001, 'Session 1', 'main', 2025),
      makeSession(1002, 'Session 2', 'main', 2025),
      makeSession(1003, 'Session 2a', 'embedded', 2025),
      makeSession(2001, 'AG Session 2', 'ag', 2025),
    ]

    const result = matchSessions(current, previous)

    expect(result).toHaveLength(4)
    expect(result.every((m) => m.matchType === 'cm_id')).toBe(true)
  })

  it('does not double-match a previous session', () => {
    // Two current sessions with different cm_ids but same name as one previous
    const current = [
      makeSession(1001, 'Session 1', 'main', 2026),
      makeSession(2001, 'Session 1', 'main', 2026), // duplicate name, different cm_id
    ]
    const previous = [makeSession(9001, 'Session 1', 'main', 2025)]

    const result = matchSessions(current, previous)

    const matched = result.filter((m) => m.previousSession !== null)
    expect(matched).toHaveLength(1) // only one should match
  })
})

// ── shiftDateByOneYear ───────────────────────────────────────────────

describe('shiftDateByOneYear', () => {
  it('shifts a date forward by one year', () => {
    expect(shiftDateByOneYear('2025-04-01')).toBe('2026-04-01')
  })

  it('handles Feb 29 in a leap year → Feb 28 in non-leap year', () => {
    expect(shiftDateByOneYear('2024-02-29')).toBe('2025-02-28')
  })

  it('shifts Dec 31 correctly', () => {
    expect(shiftDateByOneYear('2025-12-31')).toBe('2026-12-31')
  })

  it('returns empty string for empty input', () => {
    expect(shiftDateByOneYear('')).toBe('')
  })

  it('returns empty string for null/undefined-like input', () => {
    expect(shiftDateByOneYear(null as unknown as string)).toBe('')
    expect(shiftDateByOneYear(undefined as unknown as string)).toBe('')
  })
})

// ── buildPreview ─────────────────────────────────────────────────────

describe('buildPreview', () => {
  const matches: SessionMatch[] = [
    {
      currentSession: makeSession(1001, 'Session 1', 'main', 2026),
      previousSession: makeSession(1001, 'Session 1', 'main', 2025),
      matchType: 'cm_id',
    },
    {
      currentSession: makeSession(9001, 'New Session', 'main', 2026),
      previousSession: null,
      matchType: 'unmatched',
    },
  ]

  it('returns registration date items with shifted dates', () => {
    const prevRegDates = [
      makeConfig('registration', '2025', 'priority_reg_date', '2024-11-10'),
      makeConfig('registration', '2025', 'early_reg_date', '2024-11-13'),
      makeConfig('registration', '2025', 'open_reg_date', '2024-11-20'),
    ]

    const result = buildPreview(matches, prevRegDates, [], [], [], [], [], 2026)

    expect(result.registrationDates).toHaveLength(3)
    expect(result.registrationDates[0]!.key).toBe('priority_reg_date')
    expect(result.registrationDates[0]!.previousValue).toBe('2024-11-10')
    expect(result.registrationDates[0]!.newValue).toBe('2025-11-10')
    expect(result.registrationDates[0]!.existingValue).toBeNull()
  })

  it('marks registration dates as existing when current-year config exists', () => {
    const prevRegDates = [makeConfig('registration', '2025', 'priority_reg_date', '2024-11-10')]
    const curRegDates = [makeConfig('registration', '2026', 'priority_reg_date', '2025-11-09')]

    const result = buildPreview(matches, prevRegDates, [], [], curRegDates, [], [], 2026)

    expect(result.registrationDates[0]!.existingValue).toBe('2025-11-09')
  })

  it('returns grade config items for matched sessions', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.sessionName).toBe('Session 1')
    expect(result.gradeItems[0]!.previousValue).toEqual({ min_grade: 3, max_grade: 6 })
    expect(result.gradeItems[0]!.newConfigKey).toBe('1001') // current session's cm_id
  })

  it('returns budget items for matched sessions', () => {
    const prevBudgetConfig = [
      makeConfig('budget', '2025', 'session_1001', {
        participant_goal: 150,
        session_fee: 3500,
      }),
    ]

    const result = buildPreview(matches, [], [], prevBudgetConfig, [], [], [], 2026)

    expect(result.budgetItems).toHaveLength(1)
    expect(result.budgetItems[0]!.sessionName).toBe('Session 1')
    expect(result.budgetItems[0]!.previousValue).toEqual({
      participant_goal: 150,
      session_fee: 3500,
    })
    expect(result.budgetItems[0]!.newConfigKey).toBe('session_1001')
  })

  it('includes threshold in preview when present', () => {
    const prevGradeConfig = [makeConfig('session_availability', '2025', 'limited_threshold', 80)]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    expect(result.threshold).toBeDefined()
    expect(result.threshold!.previousValue).toBe(80)
  })

  it('marks threshold as existing when current config has it', () => {
    const prevGradeConfig = [makeConfig('session_availability', '2025', 'limited_threshold', 80)]
    const curGradeConfig = [makeConfig('session_availability', '2026', 'limited_threshold', 75)]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], curGradeConfig, [], 2026)

    expect(result.threshold!.existingValue).toBe(75)
  })

  it('skips sessions with no prior config', () => {
    // Session 1001 is matched but has no grade config or budget config
    const result = buildPreview(matches, [], [], [], [], [], [], 2026)

    expect(result.gradeItems).toHaveLength(0)
    expect(result.budgetItems).toHaveLength(0)
  })

  it('skips unmatched sessions in grade and budget items', () => {
    // New Session (9001) is unmatched — no previousSession
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '9001', { min_grade: 4, max_grade: 8 }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    // 9001 is the current session's cm_id but it's unmatched, and the prev config key
    // matches the unmatched current session's cm_id, not a previous session's cm_id
    // The logic should look up previous config by previous session's cm_id
    expect(result.gradeItems).toHaveLength(0)
  })

  it('computes correct summary counts', () => {
    const prevRegDates = [makeConfig('registration', '2025', 'priority_reg_date', '2024-11-10')]
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]
    const prevBudgetConfig = [
      makeConfig('budget', '2025', 'session_1001', {
        participant_goal: 150,
        session_fee: 3500,
      }),
    ]

    const result = buildPreview(
      matches,
      prevRegDates,
      prevGradeConfig,
      prevBudgetConfig,
      [],
      [],
      [],
      2026
    )

    expect(result.summary.toCreate).toBe(3) // 1 reg date + 1 grade + 1 budget
    expect(result.summary.alreadySet).toBe(0)
    expect(result.summary.unmatchedSessions).toBe(1) // "New Session"
  })

  it('counts already-set items in summary', () => {
    const prevRegDates = [makeConfig('registration', '2025', 'priority_reg_date', '2024-11-10')]
    const curRegDates = [makeConfig('registration', '2026', 'priority_reg_date', '2025-11-09')]

    const result = buildPreview(matches, prevRegDates, [], [], curRegDates, [], [], 2026)

    expect(result.summary.toCreate).toBe(0)
    expect(result.summary.alreadySet).toBe(1)
  })

  it('returns empty preview when no previous config exists', () => {
    const result = buildPreview(matches, [], [], [], [], [], [], 2026)

    expect(result.registrationDates).toHaveLength(0)
    expect(result.gradeItems).toHaveLength(0)
    expect(result.budgetItems).toHaveLength(0)
    expect(result.threshold).toBeUndefined()
    expect(result.summary.toCreate).toBe(0)
  })

  it('handles empty previous registration dates gracefully', () => {
    const prevRegDates = [makeConfig('registration', '2025', 'priority_reg_date', '')]

    const result = buildPreview(matches, prevRegDates, [], [], [], [], [], 2026)

    // Empty date values should be skipped
    expect(result.registrationDates).toHaveLength(0)
  })

  it('treats existing config with all-null values as non-existing (populatable)', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]
    // Current year has a record but all values are null — should be treated as empty
    const curGradeConfig = [
      makeConfig('session_availability', '2026', '1001', {
        min_grade: null,
        max_grade: null,
        capacity_override: null,
      }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], curGradeConfig, [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.existingValue).toBeNull() // treated as non-existing
    expect(result.summary.toCreate).toBe(1)
    expect(result.summary.alreadySet).toBe(0)
  })

  it('skips previous config with all-null values (nothing meaningful to copy)', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', {
        min_grade: null,
        max_grade: null,
        capacity_override: null,
      }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    // All-null prev config should be skipped entirely
    expect(result.gradeItems).toHaveLength(0)
  })

  it('populates previousSessionName on matched items', () => {
    const aliasMatches: SessionMatch[] = [
      {
        currentSession: makeSession(3001, 'Taste of Camp 1', 'main', 2026),
        previousSession: makeSession(5001, 'Taste of Camp', 'main', 2025),
        matchType: 'alias',
      },
    ]
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '5001', { min_grade: 2, max_grade: 5 }),
    ]

    const result = buildPreview(aliasMatches, [], prevGradeConfig, [], [], [], [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.previousSessionName).toBe('Taste of Camp')
  })

  it('sets previousSessionName to null for cm_id matches', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.previousSessionName).toBeNull()
  })

  it('sets existingRecordId when existing config has empty value', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]
    const curGradeConfig = [
      makeConfig(
        'session_availability',
        '2026',
        '1001',
        { min_grade: null, max_grade: null, capacity_override: null },
        'record_abc123'
      ),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], curGradeConfig, [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.existingValue).toBeNull() // populatable
    expect(result.gradeItems[0]!.existingRecordId).toBe('record_abc123')
  })

  it('sets existingRecordId to null when no existing record', () => {
    const prevGradeConfig = [
      makeConfig('session_availability', '2025', '1001', { min_grade: 3, max_grade: 6 }),
    ]

    const result = buildPreview(matches, [], prevGradeConfig, [], [], [], [], 2026)

    expect(result.gradeItems).toHaveLength(1)
    expect(result.gradeItems[0]!.existingValue).toBeNull()
    expect(result.gradeItems[0]!.existingRecordId).toBeNull()
  })

  it('sets existingRecordId for budget items with empty values', () => {
    const prevBudgetConfig = [
      makeConfig('budget', '2025', 'session_1001', { participant_goal: 150, session_fee: 3500 }),
    ]
    const curBudgetConfig = [
      makeConfig(
        'budget',
        '2026',
        'session_1001',
        { participant_goal: null, session_fee: null },
        'budget_rec_xyz'
      ),
    ]

    const result = buildPreview(matches, [], [], prevBudgetConfig, [], [], curBudgetConfig, 2026)

    expect(result.budgetItems).toHaveLength(1)
    expect(result.budgetItems[0]!.existingValue).toBeNull()
    expect(result.budgetItems[0]!.existingRecordId).toBe('budget_rec_xyz')
  })

  it('populates unmatchedSessionNames correctly', () => {
    const multiMatches: SessionMatch[] = [
      {
        currentSession: makeSession(1001, 'Session 1', 'main', 2026),
        previousSession: makeSession(1001, 'Session 1', 'main', 2025),
        matchType: 'cm_id',
      },
      {
        currentSession: makeSession(9001, 'Brand New Session', 'main', 2026),
        previousSession: null,
        matchType: 'unmatched',
      },
      {
        currentSession: makeSession(9002, 'Quest Extended', 'quest', 2026),
        previousSession: null,
        matchType: 'unmatched',
      },
    ]

    const result = buildPreview(multiMatches, [], [], [], [], [], [], 2026)

    expect(result.summary.unmatchedSessions).toBe(2)
    expect(result.summary.unmatchedSessionNames).toEqual(['Brand New Session', 'Quest Extended'])
  })

  it('returns empty unmatchedSessionNames when all sessions match', () => {
    const allMatched: SessionMatch[] = [
      {
        currentSession: makeSession(1001, 'Session 1', 'main', 2026),
        previousSession: makeSession(1001, 'Session 1', 'main', 2025),
        matchType: 'cm_id',
      },
    ]

    const result = buildPreview(allMatched, [], [], [], [], [], [], 2026)

    expect(result.summary.unmatchedSessions).toBe(0)
    expect(result.summary.unmatchedSessionNames).toEqual([])
  })

  it('carries teen type_<name> budget config forward to the same key', () => {
    const prevBudgetConfig = [
      makeConfig('budget', '2025', 'session_1001', {
        participant_goal: 150,
        session_fee: 3500,
      }),
      makeConfig('budget', '2025', 'type_scit', {
        participant_goal: 50,
        session_fee: 1500,
      }),
    ]

    const result = buildPreview(matches, [], [], prevBudgetConfig, [], [], [], 2026)

    const teen = result.budgetItems.find((b) => b.newConfigKey === 'type_scit')
    expect(teen).toBeDefined()
    expect(teen!.previousValue).toEqual({ participant_goal: 50, session_fee: 1500 })
    expect(teen!.existingValue).toBeNull() // not yet set for the target year
  })

  it('does not overwrite type_<name> budget config already set for current year', () => {
    const prevBudgetConfig = [
      makeConfig('budget', '2025', 'type_scit', {
        participant_goal: 50,
        session_fee: 1500,
      }),
    ]
    const curBudgetConfig = [
      makeConfig('budget', '2026', 'type_scit', {
        participant_goal: 60,
        session_fee: 1600,
      }),
    ]

    const result = buildPreview(matches, [], [], prevBudgetConfig, [], [], curBudgetConfig, 2026)

    const teen = result.budgetItems.find((b) => b.newConfigKey === 'type_scit')
    expect(teen).toBeDefined()
    expect(teen!.existingValue).toEqual({ participant_goal: 60, session_fee: 1600 })
  })
})

// ── isEmptyValue ──────────────────────────────────────────────────────

describe('isEmptyValue', () => {
  it('returns true for null', () => {
    expect(isEmptyValue(null)).toBe(true)
  })

  it('returns true for undefined', () => {
    expect(isEmptyValue(undefined)).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(isEmptyValue('')).toBe(true)
  })

  it('returns true for object with all null properties', () => {
    expect(isEmptyValue({ min_grade: null, max_grade: null, capacity_override: null })).toBe(true)
  })

  it('returns true for object with all undefined properties', () => {
    expect(isEmptyValue({ min_grade: undefined, max_grade: undefined })).toBe(true)
  })

  it('returns false for object with at least one non-null property', () => {
    expect(isEmptyValue({ min_grade: 3, max_grade: null })).toBe(false)
  })

  it('returns false for non-empty string', () => {
    expect(isEmptyValue('2025-01-01')).toBe(false)
  })

  it('returns false for number', () => {
    expect(isEmptyValue(42)).toBe(false)
  })

  it('returns false for zero', () => {
    expect(isEmptyValue(0)).toBe(false)
  })
})
