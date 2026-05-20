import { describe, it, expect } from 'vitest'
import { buildFamilyRows } from './familyRows'
import type { ValidationStatistics, ImpossibilityReport } from '../../services/solver'

const _statistics = (overrides: Partial<ValidationStatistics> = {}): ValidationStatistics => ({
  total_campers: 0,
  assigned_campers: 0,
  unassigned_campers: 0,
  total_requests: 0,
  satisfied_requests: 0,
  request_satisfaction_rate: 0,
  bunks_at_capacity: 0,
  bunks_under_capacity: 0,
  bunks_over_capacity: 0,
  field_stats: {},
  negative_request_violations_detail: [],
  priority_unsuccessfuls: [],
  ...overrides,
})

const _report = (overrides: Partial<ImpossibilityReport> = {}): ImpossibilityReport => ({
  total_impossible: 0,
  affected_campers: 0,
  by_reason: {},
  flat: [],
  mp_campers_entirely_impossible: [],
  ...overrides,
})

describe('buildFamilyRows — Group 65 #1540', () => {
  it('collapses multi-session got_nothing rows for same camper into one row with sessions[] populated', () => {
    const stats = _statistics()
    const report = _report({
      mp_campers_entirely_impossible: [
        {
          cm_id: 12345,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: ['x'],
        },
        {
          cm_id: 12345,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          session_cm_id: 1000003,
          reason_codes: ['x'],
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Emma Johnson')
    expect(rows[0]!.sessions).toEqual(['1000001', '1000003'])
    expect(rows[0]!.subRows).toHaveLength(2)
    expect(rows[0]!.subRows[0]!.session).toBe('1000001')
  })

  it('keeps separate rows when same camper has different cohorts (got_nothing AND priority_unmet)', () => {
    const stats = _statistics({
      priority_unsuccessfuls: [
        {
          requester_cm_id: '12345',
          target_cm_id: '99',
          requester_name: 'Emma Johnson',
          target_name: 'Liam Garcia',
          raw_text: 'must bunk',
          session_cm_id: '1000002',
          requester_grade: 4,
        },
      ],
    })
    const report = _report({
      mp_campers_entirely_impossible: [
        {
          cm_id: 12345,
          name: 'Emma Johnson',
          grade: 4,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: [],
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.cohort).sort()).toEqual(['got_nothing', 'priority_unmet'])
  })

  it('sorts by grade ascending, then by name ascending within grade', () => {
    const stats = _statistics()
    const report = _report({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1,
          name: 'Zoe Williams',
          grade: 3,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: [],
        },
        {
          cm_id: 2,
          name: 'Aaron Brown',
          grade: 5,
          gender: 'M',
          session_cm_id: 1000001,
          reason_codes: [],
        },
        {
          cm_id: 3,
          name: 'Bella Davis',
          grade: 3,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: [],
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows.map((r) => r.name)).toEqual(['Bella Davis', 'Zoe Williams', 'Aaron Brown'])
  })

  it('uses requester_grade from violation/priority rows for sort', () => {
    const stats = _statistics({
      negative_request_violations_detail: [
        {
          requester_cm_id: '1',
          target_cm_id: '2',
          requester_name: 'Liam Garcia',
          target_name: 'X',
          bunk_cm_id: 'b1',
          bunk_name: 'Bunk 1',
          session_cm_id: '1000001',
          requester_grade: 6,
        },
      ],
      priority_unsuccessfuls: [
        {
          requester_cm_id: '3',
          target_cm_id: '4',
          requester_name: 'Aaron Brown',
          target_name: 'Y',
          raw_text: '',
          session_cm_id: '1000001',
          requester_grade: 2,
        },
      ],
    })
    const report = _report()
    const rows = buildFamilyRows(stats, report)
    expect(rows.map((r) => r.name)).toEqual(['Aaron Brown', 'Liam Garcia'])
  })

  it('null requester_grade sorts as 0 (treated as lowest grade)', () => {
    const stats = _statistics({
      negative_request_violations_detail: [
        {
          requester_cm_id: '1',
          target_cm_id: '2',
          requester_name: 'Has Grade',
          target_name: 'X',
          bunk_cm_id: 'b1',
          bunk_name: 'B',
          session_cm_id: '1000001',
          requester_grade: 4,
        },
        {
          requester_cm_id: '3',
          target_cm_id: '4',
          requester_name: 'No Grade',
          target_name: 'Y',
          bunk_cm_id: 'b2',
          bunk_name: 'B2',
          session_cm_id: '1000001',
          requester_grade: null,
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    expect(rows[0]!.name).toBe('No Grade') // grade=null → 0 → first
    expect(rows[1]!.name).toBe('Has Grade')
  })
})
