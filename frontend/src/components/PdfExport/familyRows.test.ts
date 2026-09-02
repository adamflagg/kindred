import { describe, it, expect } from 'vitest'
import { buildFamilyRows, cohortLabel } from './familyRows'
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

describe('buildFamilyRows — honored reconciliation', () => {
  it('re-labels partially-honored campers as sacrificed_mp (not got_nothing / "Met by same age cabin")', () => {
    // honored_in_plan=true but no fully_honored → partial → sacrificed_mp, NOT got_nothing.
    // This is the fix for #1716: previously produced got_nothing + "Met by same age cabin" (false positive).
    const stats = _statistics({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000001,
          name: 'Samuel Johnson',
          grade: 10,
          gender: 'M',
          session_cm_id: 1000001,
          reason_codes: ['age_pref_no_eligible_grade'],
          honored_in_plan: true,
          bunk_name: 'Redwood 4',
        },
      ],
    })
    // Pre-check report intentionally empty: statistics is authoritative.
    const rows = buildFamilyRows(stats, _report())
    expect(rows).toHaveLength(1)
    expect(rows[0]!.cohort).toBe('sacrificed_mp')
    expect(rows[0]!.subRows[0]!.honoredInPlan).toBe(true)
    expect(rows[0]!.subRows[0]!.bunkName).toBe('Redwood 4')
    expect(rows[0]!.subRows[0]!.detail).not.toContain('Met by same age cabin')
    expect(rows[0]!.subRows[0]!.detail).toContain('Material request unmet')
  })

  it('keeps the impossible detail when honored_in_plan is false', () => {
    const stats = _statistics({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000002,
          name: 'Olivia Chen',
          grade: 5,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: ['age_pref_no_eligible_grade'],
          honored_in_plan: false,
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    expect(rows[0]!.subRows[0]!.honoredInPlan).toBe(false)
    expect(rows[0]!.subRows[0]!.detail).toContain('All requests impossible')
  })

  it('falls back to the pre-check report when statistics cohort is absent', () => {
    const stats = _statistics() // no mp_campers_entirely_impossible
    const report = _report({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000003,
          name: 'Liam Garcia',
          grade: 5,
          gender: 'M',
          session_cm_id: 1000001,
          reason_codes: ['age_pref_no_eligible_grade'],
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Liam Garcia')
    expect(rows[0]!.subRows[0]!.honoredInPlan).toBeUndefined()
  })

  it('drops fully-honored campers (got their whole material ask)', () => {
    // #1716: fully_honored=true means camper got everything; don't show them in the contact list.
    const stats = _statistics({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1,
          name: 'Emma Johnson',
          grade: 7,
          gender: 'F',
          session_cm_id: 10,
          reason_codes: ['age_pref_no_eligible_grade'],
          honored_in_plan: true,
          fully_honored: true,
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    expect(rows.find((r) => r.cm_id === '1')).toBeUndefined()
  })

  it('re-labels partially-honored campers as request-dropped, not "met"', () => {
    // #1716: honored_in_plan=true + fully_honored=false → partial → sacrificed_mp,
    // detail must NOT contain "Met by same age cabin".
    const stats = _statistics({
      mp_campers_entirely_impossible: [
        {
          cm_id: 2,
          name: 'Liam Garcia',
          grade: 5,
          gender: 'M',
          session_cm_id: 10,
          reason_codes: ['target_not_in_solver'],
          honored_in_plan: true,
          fully_honored: false,
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const row = rows.find((r) => r.cm_id === '2')!
    expect(row).toBeDefined()
    expect(row.cohort).toBe('sacrificed_mp')
    expect(row.subRows[0]!.detail).not.toContain('Met by same age cabin')
  })

  it('treats an explicit empty stats cohort as authoritative (no fallback to pre-check)', () => {
    // Post-check ran and found zero entirely-impossible campers; a stale
    // pre-check report must NOT resurface got_nothing rows.
    const stats = _statistics({ mp_campers_entirely_impossible: [] })
    const report = _report({
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000001,
          name: 'Emma Johnson',
          grade: 5,
          gender: 'F',
          session_cm_id: 1000001,
          reason_codes: ['age_pref_no_eligible_grade'],
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows.filter((r) => r.cohort === 'got_nothing')).toHaveLength(0)
  })
})

describe('buildFamilyRows — sacrificed material-parent cohort (Stream D, Phase 3)', () => {
  it('surfaces a bunk_with unsatisfied MP request as a sacrificed_mp row with correct reason', () => {
    const stats = _statistics({
      unsatisfied_material_parent_detail: [
        {
          requester_cm_id: '42001',
          requester_name: 'Emma Johnson',
          request_type: 'bunk_with',
          target_cm_id: '42002',
          target_name: 'Liam Garcia',
          requester_bunk_name: 'Cedar 1',
          target_bunk_name: 'Cedar 2',
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const match = rows.find((r) => r.cohort === 'sacrificed_mp')
    expect(match).toBeDefined()
    expect(match!.name).toBe('Emma Johnson')
    expect(match!.cm_id).toBe('42001')
    expect(match!.subRows[0]!.detail).toBe(
      'Material request unmet: wanted to bunk with Liam Garcia'
    )
  })

  it('surfaces a not_bunk_with unsatisfied MP request with correct reason', () => {
    const stats = _statistics({
      unsatisfied_material_parent_detail: [
        {
          requester_cm_id: '42003',
          requester_name: 'Olivia Chen',
          request_type: 'not_bunk_with',
          target_cm_id: '42004',
          target_name: 'Riley Sam',
          requester_bunk_name: 'Maple 3',
          target_bunk_name: 'Maple 3',
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const match = rows.find((r) => r.cohort === 'sacrificed_mp')
    expect(match).toBeDefined()
    expect(match!.subRows[0]!.detail).toBe(
      'Material request unmet: wanted to NOT bunk with Riley Sam'
    )
  })

  it('surfaces an age_preference unsatisfied MP request with the preference label', () => {
    const stats = _statistics({
      unsatisfied_material_parent_detail: [
        {
          requester_cm_id: '42005',
          requester_name: 'Samuel Johnson',
          request_type: 'age_preference',
          target_cm_id: '',
          target_name: 'older',
          requester_bunk_name: 'Redwood 4',
          target_bunk_name: 'n/a',
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const match = rows.find((r) => r.cohort === 'sacrificed_mp')
    expect(match).toBeDefined()
    expect(match!.subRows[0]!.detail).toBe('Material request unmet: age preference (older)')
  })

  it('collapses multiple unsatisfied MP entries for the same camper into one row', () => {
    const stats = _statistics({
      unsatisfied_material_parent_detail: [
        {
          requester_cm_id: '42001',
          requester_name: 'Emma Johnson',
          request_type: 'bunk_with',
          target_cm_id: '42002',
          target_name: 'Liam Garcia',
          requester_bunk_name: 'Cedar 1',
          target_bunk_name: 'Cedar 2',
        },
        {
          requester_cm_id: '42001',
          requester_name: 'Emma Johnson',
          request_type: 'age_preference',
          target_cm_id: '',
          target_name: 'older',
          requester_bunk_name: 'Cedar 1',
          target_bunk_name: 'n/a',
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const sacrificedRows = rows.filter((r) => r.cohort === 'sacrificed_mp')
    expect(sacrificedRows).toHaveLength(1)
    expect(sacrificedRows[0]!.subRows).toHaveLength(2)
  })

  it('returns an empty array when unsatisfied_material_parent_detail is absent', () => {
    const stats = _statistics() // no unsatisfied_material_parent_detail
    const rows = buildFamilyRows(stats, _report())
    expect(rows.filter((r) => r.cohort === 'sacrificed_mp')).toHaveLength(0)
  })

  it('uses unknown request type fallback gracefully', () => {
    const stats = _statistics({
      unsatisfied_material_parent_detail: [
        {
          requester_cm_id: '42009',
          requester_name: 'Riley Sam',
          request_type: 'some_future_type',
          target_cm_id: '42010',
          target_name: 'Olivia Chen',
          requester_bunk_name: 'Oak 1',
          target_bunk_name: 'Oak 2',
        },
      ],
    })
    const rows = buildFamilyRows(stats, _report())
    const match = rows.find((r) => r.cohort === 'sacrificed_mp')
    expect(match).toBeDefined()
    // Should still produce a row with some detail text
    expect(match!.subRows[0]!.detail).toContain('Material request unmet')
  })
})

describe('cohortLabel', () => {
  it('labels the sacrificed material-parent cohort as "Request dropped"', () => {
    // Staff-facing wording: a break-glass placement "drops" an unmet request
    // rather than "sacrificing" it (gentler, clearer terminology).
    expect(cohortLabel('sacrificed_mp')).toBe('Request dropped')
  })
  it('labels the impossible_request cohort as "Request can\'t be placed"', () => {
    expect(cohortLabel('impossible_request')).toBe("Request can't be placed")
  })
})

describe('buildFamilyRows — #1717 pre-check impossibility fold-in', () => {
  it('folds in a pre-check impossibility for a camper not in any cohort', () => {
    const stats = _statistics({ mp_campers_entirely_impossible: [] })
    const report = _report({
      flat: [
        {
          request_id: 'r1',
          reason_code: 'target_not_in_solver',
          reason_message: '',
          request_type: 'bunk_with',
          source_field: 'bunk_request_form',
          requester: { cm_id: 9, name: 'Noah Davis', grade: 4, gender: 'M' },
          requestee: null,
          detail: {},
          bucket: 'material_parent',
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    const row = rows.find((r) => r.cm_id === '9')!
    expect(row).toBeDefined()
    expect(row.cohort).toBe('impossible_request')
    expect(row.subRows[0]!.reasonCodes).toEqual(['target_not_in_solver'])
  })

  it('does NOT duplicate a camper already shown via a cohort', () => {
    const stats = _statistics({
      mp_campers_entirely_impossible: [
        {
          cm_id: 9,
          name: 'Noah Davis',
          grade: 4,
          gender: 'M',
          session_cm_id: 10,
          reason_codes: ['target_not_in_solver'],
          honored_in_plan: false,
          fully_honored: false,
        },
      ],
    })
    const report = _report({
      flat: [
        {
          request_id: 'r1',
          reason_code: 'target_not_in_solver',
          reason_message: '',
          request_type: 'bunk_with',
          source_field: 'bunk_request_form',
          requester: { cm_id: 9, name: 'Noah Davis', grade: 4, gender: 'M' },
          requestee: null,
          detail: {},
          bucket: 'material_parent',
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows.filter((r) => r.cm_id === '9')).toHaveLength(1)
  })

  it('mirrors the pre-check conditional filter: socialize_with hidden ONLY under age_pref', () => {
    // Parity with PreValidationResultsModal (lines 581-584): it filters out
    // socialize_with rows (isMaterialRequest=false) ONLY for the
    // age_pref_no_eligible_grade reason (Group 65 #1537); every other reason
    // shows all items. So a socialize_with friend who isn't enrolled
    // (target_not_in_solver) is SHOWN by the pre-check and must survive here too.
    const stats = _statistics({ mp_campers_entirely_impossible: [] })
    const report = _report({
      flat: [
        // EXCLUDED: socialize_with under age_pref — pre-check hides this.
        {
          request_id: 'r2',
          reason_code: 'age_pref_no_eligible_grade',
          reason_message: '',
          request_type: 'age_preference',
          source_field: 'socialize_with',
          requester: { cm_id: 77, name: 'Lily Adams', grade: 5, gender: 'F' },
          requestee: null,
          detail: {},
          bucket: 'immaterial_parent',
        },
        // INCLUDED: socialize_with under a NON-age-pref reason — pre-check shows
        // this; the old blanket filter wrongly dropped it.
        {
          request_id: 'r3',
          reason_code: 'target_not_in_solver',
          reason_message: '',
          request_type: 'bunk_with',
          source_field: 'socialize_with',
          requester: { cm_id: 88, name: 'Mason Reed', grade: 6, gender: 'M' },
          requestee: null,
          detail: {},
          bucket: 'immaterial_parent',
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    expect(rows.find((r) => r.cm_id === '77')).toBeUndefined()
    const included = rows.find((r) => r.cm_id === '88')
    expect(included).toBeDefined()
    expect(included!.cohort).toBe('impossible_request')
  })
})

describe('buildFamilyRows — off-roster requester (kindred#2689)', () => {
  it('falls back to "#<cm_id>" instead of a blank name when requester is the one-key fallback dict', () => {
    // Python's impossibility.py emits requester={"cm_id": ...} (no name/grade/
    // gender) when the requester person isn't in the solver's roster. The TS
    // type reflects this by making everything but cm_id optional — assert the
    // row gets a usable identifier, not an empty string.
    const stats = _statistics({ mp_campers_entirely_impossible: [] })
    const report = _report({
      flat: [
        {
          request_id: 'r1',
          reason_code: 'malformed',
          reason_message: '',
          request_type: 'bunk_with',
          source_field: 'bunk_request_form',
          requester: { cm_id: 999 },
          requestee: null,
          detail: {},
          bucket: 'material_parent',
        },
      ],
    })
    const rows = buildFamilyRows(stats, report)
    const row = rows.find((r) => r.cm_id === '999')
    expect(row).toBeDefined()
    expect(row!.name).toBe('#999')
    expect(row!.grade).toBe(0)
    expect(row!.gender).toBe('')
  })
})
