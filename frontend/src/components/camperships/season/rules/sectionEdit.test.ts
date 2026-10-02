import { describe, expect, it } from 'vitest'

import { contentOf } from './rulesFixtures'
import {
  applyEdits,
  editKey,
  fieldName,
  fieldSpec,
  parseSetting,
  sectionChanges,
  setAt,
  touches,
  valueAt,
} from './sectionEdit'

describe('what takes a box (Decision 14)', () => {
  it('types figures, yes/no and choices; leaves names, references, dates and lists as they are', () => {
    expect(fieldSpec(['minimum'], '100')).toEqual({
      kind: 'number',
      unit: 'money',
      whole: false,
      nullable: false,
    })
    expect(fieldSpec(['general', 'tiers', '2', 'r1_pct'], '60')).toMatchObject({
      kind: 'number',
      unit: 'percent',
    })
    expect(fieldSpec(['floor_tier'], 1)).toMatchObject({ kind: 'number', whole: true })
    expect(fieldSpec(['ask_cap'], true)).toEqual({ kind: 'yesno' })
    expect(fieldSpec(['offset_mode'], 'dollar')).toMatchObject({
      kind: 'choice',
      options: ['dollar', 'reduce_cost_basis'],
    })
    expect(fieldSpec(['summer', 'label'], 'Summer')).toBeNull()
    expect(fieldSpec(['summer', 'r1_table'], 'general')).toBeNull()
    expect(fieldSpec(['application_deadline'], '2027-01-31')).toBeNull()
    expect(fieldSpec(['offset_programs'], ['summer'])).toBeNull()
  })

  it('lets an optional setting be emptied, and no other', () => {
    expect(fieldSpec(['income_ceiling'], null)).toMatchObject({ kind: 'number', nullable: true })
    expect(fieldSpec(['registrar_limit'], '300')).toMatchObject({ nullable: true })
    expect(fieldSpec(['checks', 'income_above', 'threshold'], null)).toMatchObject({
      nullable: true,
    })
    expect(fieldSpec(['extra_terms', '0', 'threshold'], '0')).toMatchObject({ nullable: false })
    expect(fieldSpec(['inherits'], null)).toBeNull()
  })
})

describe('reading a box (Decision 14)', () => {
  const money = { kind: 'number', unit: 'money', whole: false, nullable: false } as const
  const percent = { kind: 'number', unit: 'percent', whole: false, nullable: false } as const

  it("reads what staff type, back in the server's form", () => {
    expect(parseSetting('$1,000,000', money)).toEqual({ kind: 'ok', value: '1000000' })
    expect(parseSetting('72%', percent)).toEqual({ kind: 'ok', value: '72' })
    expect(
      parseSetting('3', { kind: 'number', unit: 'plain', whole: true, nullable: false })
    ).toEqual({ kind: 'ok', value: 3 })
    expect(parseSetting('', { ...money, nullable: true })).toEqual({ kind: 'ok', value: null })
    expect(parseSetting('true', { kind: 'yesno' })).toEqual({ kind: 'ok', value: true })
  })

  it('refuses what it would have to guess at', () => {
    expect(parseSetting('12,50', money)).toEqual({ kind: 'invalid', reason: 'Not a number' })
    expect(parseSetting('10.505', money)).toEqual({
      kind: 'invalid',
      reason: 'Cents go to two places',
    })
    expect(parseSetting('101', percent)).toEqual({ kind: 'invalid', reason: 'At most 100%' })
    expect(parseSetting('', money)).toEqual({ kind: 'invalid', reason: 'Needs a figure' })
    expect(
      parseSetting('2.5', { kind: 'number', unit: 'plain', whole: true, nullable: false })
    ).toEqual({
      kind: 'invalid',
      reason: 'A whole number',
    })
  })
})

describe('applying what was typed', () => {
  const awards = contentOf('awards')
  const specOf = (path: readonly string[]) => fieldSpec(path, valueAt(awards, path))

  it('sets each read box, touches nothing else, and lists what differs from the section as opened', () => {
    const applied = applyEdits(awards, new Map([[editKey(['minimum']), '150']]), specOf)
    expect(applied.content).toEqual({ ...awards, minimum: '150' })
    expect(applied.changed).toEqual([['minimum']])
    expect(applied.problems.size).toBe(0)
  })

  it('counts a figure typed back to its own value as no change ("100" is "100.00")', () => {
    expect(applyEdits(awards, new Map([[editKey(['minimum']), '100.00']]), specOf).changed).toEqual(
      []
    )
  })

  it("names a box it can't read and leaves its setting as it was", () => {
    const applied = applyEdits(awards, new Map([[editKey(['minimum']), 'abc']]), specOf)
    expect(applied.problems.get(editKey(['minimum']))).toBe('Not a number')
    expect(applied.content).toEqual(awards)
  })

  it("writes into a list by its index, keeping the list's order", () => {
    const tiers = contentOf('tiers')
    expect(setAt(tiers, ['bands', '1', 'upper'], '75000')).toEqual({
      ...tiers,
      bands: [
        { lower: '0', upper: '40000' },
        { lower: '40001', upper: '75000' },
        { lower: '70001', upper: null },
      ],
    })
  })
})

describe("what someone else changed (G6's answer)", () => {
  it('lists every setting that differs, lists whole, in the server change shape', () => {
    const before = { minimum: '100', ask_cap: true, decision_types: {} }
    const after = { minimum: '120', ask_cap: true, decision_types: {}, extra: 1 }
    expect(sectionChanges(before, after)).toEqual([
      { path: ['minimum'], kind: 'changed', before: '100', after: '120' },
      { path: ['extra'], kind: 'added', before: null, after: 1 },
    ])
    expect(sectionChanges({ minimum: '100' }, { minimum: '100.00' })).toEqual([])
  })

  it('names a box by its whole path, as its changes read', () => {
    expect(fieldName(['general', 'tiers', '2', 'r1_pct'])).toBe(
      'General › Tiers › Tier 2 › Round 1 %'
    )
  })
})

describe("reading a box as the server's schema validates it", () => {
  const money = { kind: 'number', unit: 'money', whole: false, nullable: false } as const
  const plain = { kind: 'number', unit: 'plain', whole: false, nullable: false } as const

  it('types a 0-to-1 fraction as such, and refuses what the schema would', () => {
    for (const path of [
      ['weights', 'prior_year'],
      ['medical_rate'],
      ['savings_inclusion_rate'],
      ['extra_terms', '0', 'rate'],
    ]) {
      expect(fieldSpec(path, '0.5')).toMatchObject({ kind: 'number', fraction: true })
    }
    // Equity weights are only non-negative, and tier tables are percent points.
    expect(fieldSpec(['weights', 'class_a', 'crit_a'], '2')).not.toHaveProperty('fraction')
    const fraction = fieldSpec(['medical_rate'], '1')
    if (fraction?.kind !== 'number') throw new Error('expected a number spec')
    expect(parseSetting('0.25', fraction)).toEqual({ kind: 'ok', value: '0.25' })
    expect(parseSetting('1', fraction)).toEqual({ kind: 'ok', value: '1' })
    expect(parseSetting('1.00', fraction)).toEqual({ kind: 'ok', value: '1.00' })
    expect(parseSetting('1.5', fraction)).toEqual({ kind: 'invalid', reason: 'Between 0 and 1' })
    expect(parseSetting('1.0001', fraction)).toEqual({ kind: 'invalid', reason: 'Between 0 and 1' })
    expect(parseSetting('72%', fraction)).toEqual({ kind: 'invalid', reason: 'No % in this box' })
  })

  it('takes money to two places only, as a string, with no float maths', () => {
    expect(parseSetting('10.50', money)).toEqual({ kind: 'ok', value: '10.50' })
    expect(parseSetting('10.505', money)).toEqual({
      kind: 'invalid',
      reason: 'Cents go to two places',
    })
    expect(parseSetting('10.500', money)).toEqual({
      kind: 'invalid',
      reason: 'Cents go to two places',
    })
    expect(parseSetting('9007199254740993.01', money)).toEqual({
      kind: 'ok',
      value: '9007199254740993.01',
    })
    expect(parseSetting('-5', money)).toEqual({ kind: 'invalid', reason: 'Not a number' })
  })

  it('holds a percent to 100 exactly, and a count to the schema bounds', () => {
    const percent = { kind: 'number', unit: 'percent', whole: false, nullable: false } as const
    expect(parseSetting('100.00', percent)).toEqual({ kind: 'ok', value: '100.00' })
    expect(parseSetting('100.01', percent)).toEqual({ kind: 'invalid', reason: 'At most 100%' })
    expect(fieldSpec(['floor_tier'], 1)).toMatchObject({ whole: true, min: 1 })
    expect(fieldSpec(['decision_types', 'discount', 'round'], 2)).toMatchObject({ min: 1, max: 3 })
    const tier = fieldSpec(['floor_tier'], 1)
    if (tier?.kind !== 'number') throw new Error('expected a number spec')
    expect(parseSetting('0', tier)).toEqual({ kind: 'invalid', reason: 'At least 1' })
    expect(parseSetting('4', { ...tier, max: 3 })).toEqual({ kind: 'invalid', reason: 'At most 3' })
  })

  it('reads a plain decimal (a weight) as typed', () => {
    expect(parseSetting('2.25', plain)).toEqual({ kind: 'ok', value: '2.25' })
  })

  it('leaves a numeric-looking name alone', () => {
    expect(fieldSpec(['criteria', '0', 'label'], '2024')).toBeNull()
    expect(fieldSpec(['decision_types', 'discount', 'budget_line'], '100')).toBeNull()
  })

  it('compares as the server does, lists whole and decimals by value', () => {
    // A list of plain values is compared exactly: the server never parses a string (I2).
    expect(sectionChanges({ values: ['10'] }, { values: ['10.0'] })).toHaveLength(1)
    expect(sectionChanges({ label: '2024' }, { label: '2024.0' })).toHaveLength(1)
    expect(sectionChanges({ bands: [{ lower: '0' }] }, { bands: [{ lower: '0.00' }] })).toEqual([])
    expect(sectionChanges({ a: ['x'] }, { a: ['x', 'y'] })).toEqual([
      { path: ['a'], kind: 'changed', before: ['x'], after: ['x', 'y'] },
    ])
    expect(sectionChanges({}, { pools: { a: { total: '5' } } })).toEqual([
      { path: ['pools', 'a', 'total'], kind: 'added', before: null, after: '5' },
    ])
    expect(sectionChanges({ a: true }, { a: 1 })).toHaveLength(1)
  })
})

describe('what is never a box, however it looks', () => {
  it('never boxes a CampMinder session reference (I1)', () => {
    expect(fieldSpec(['family_rates', '0', 'session_cm_id'], 1234)).toBeNull()
    expect(fieldSpec(['programs', 'summer', 'session_cm_id'], 1234)).toBeNull()
  })

  it('reads a user-named key as a user-named key, not as the field it spells (m3)', () => {
    const weight = fieldSpec(['weights', 'class_a', 'child'], '2')
    expect(weight).toEqual({ kind: 'number', unit: 'plain', whole: false, nullable: false })
    expect(fieldSpec(['weights', 'class_a', 'child'], null)).toBeNull()
    expect(fieldSpec(['weights', 'class_a', 'prior_year'], '2')).not.toHaveProperty('fraction')
    expect(fieldSpec(['weights', 'class_a', 'round'], 2)).not.toHaveProperty('max')
    expect(fieldSpec(['program_tables', 'child'], null)).toBeNull()
    // The income weights are still fractions.
    expect(fieldSpec(['weights', 'prior_year'], '0.5')).toMatchObject({ fraction: true })
  })

  it('offers only the kind switches that can save (m5)', () => {
    expect(fieldSpec(['decision_types', 'd', 'kind'], 'discretionary')).toEqual({
      kind: 'choice',
      options: ['full_cost', 'discretionary'],
    })
    expect(fieldSpec(['decision_types', 'd', 'kind'], 'top_up')).toBeNull()
  })
})

describe('a symbol only in its own box (m1)', () => {
  const money = { kind: 'number', unit: 'money', whole: false, nullable: false } as const
  const percent = { kind: 'number', unit: 'percent', whole: false, nullable: false } as const
  it('refuses a % in money and a $ in a percent, instead of stripping it', () => {
    expect(parseSetting('5%', money)).toEqual({ kind: 'invalid', reason: 'No % in this box' })
    expect(parseSetting('$50', percent)).toEqual({ kind: 'invalid', reason: 'No $ in this box' })
    expect(
      parseSetting('$2', { kind: 'number', unit: 'plain', whole: true, nullable: false })
    ).toEqual({ kind: 'invalid', reason: 'No $ in this box' })
    expect(parseSetting('$5', money)).toEqual({ kind: 'ok', value: '5' })
    expect(parseSetting('50%', percent)).toEqual({ kind: 'ok', value: '50' })
  })
})

describe('where an edit and a change meet (I3)', () => {
  it('touches when either path is a prefix of the other', () => {
    expect(touches(['bands', '1', 'upper'], ['bands'])).toBe(true)
    expect(touches(['bands'], ['bands', '1', 'upper'])).toBe(true)
    expect(touches(['bands', '1', 'upper'], ['bands', '1', 'upper'])).toBe(true)
    expect(touches(['bands', '1', 'upper'], ['bands', '2'])).toBe(false)
    expect(touches(['minimum'], ['minimum_when_cost_unknown'])).toBe(false)
  })

  it('flags a typed row that is gone after a rebase, instead of dropping it', () => {
    const tiers = contentOf('tiers')
    const rebased = { ...tiers, bands: [{ lower: '0', upper: '40000' }] }
    const specOf = (path: readonly string[]) => fieldSpec(path, valueAt(rebased, path))
    const applied = applyEdits(
      rebased,
      new Map([[editKey(['bands', '2', 'lower']), '80000']]),
      specOf
    )
    expect(applied.problems.get(editKey(['bands', '2', 'lower']))).toBe(
      'Row 3 of Income bands is gone; retype it'
    )
    expect(applied.gone.has(editKey(['bands', '2', 'lower']))).toBe(true)
    expect(applied.content).toEqual(rebased)
  })
})

describe('the null side of a change (m4)', () => {
  it('carries null before an add and after a remove, as the server does', () => {
    expect(sectionChanges({ a: 1 }, {})).toEqual([
      { path: ['a'], kind: 'removed', before: 1, after: null },
    ])
  })
})
