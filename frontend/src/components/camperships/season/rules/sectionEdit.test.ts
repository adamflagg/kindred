import { describe, expect, it } from 'vitest'

import { RULES_DOCUMENT, contentOf } from './rulesFixtures'
import {
  applyEdits,
  boxText,
  editKey,
  fieldName,
  fieldSpec,
  parseSetting,
  prepareContent,
  refusalWords,
  sectionChanges,
  setAt,
  touches,
  valueAt,
  type EditContext,
} from './sectionEdit'

describe('Extra amount takes a box on a full_cost decision type only', () => {
  const content = {
    decision_types: {
      full: { kind: 'full_cost', extra_amount: '0' },
      appeal: { kind: 'discretionary', extra_amount: '0' },
    },
  }
  const specAt = (type: string) => fieldSpec(['decision_types', type, 'extra_amount'], '0', content)
  it('boxes it where the server accepts it and reads it as words elsewhere', () => {
    expect(specAt('full')).toMatchObject({ kind: 'number', unit: 'money' })
    expect(specAt('appeal')).toBeNull()
  })
})

describe('refusalWords: a 422 from a section save, in plain words', () => {
  it('names each field the way its box is named, and keeps the server reason', () => {
    expect(
      refusalWords(
        'awards is not a valid section: awards.decision_types.appeal_top_up: Value error, only a full_cost decision type has extra_amount'
      )
    ).toBe(
      'The rules draft refused this change: Decision types › Appeal top up: only a full_cost decision type has extra_amount.'
    )
  })
  it('leaves any other message alone', () => {
    expect(refusalWords('A section has errors')).toBeNull()
  })
})

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

describe('a money box shows whole dollars, as stored (coordinator B7; lead ruling)', () => {
  const money = { kind: 'number', unit: 'money', whole: false, nullable: false } as const

  it('shows a stored whole figure with commas and no ".0"', () => {
    expect(boxText('6695.0', money)).toBe('6,695')
    expect(boxText('6695', money)).toBe('6,695')
    expect(boxText(6695, { ...money, whole: true })).toBe('6,695')
    expect(boxText('150', money)).toBe('150')
  })

  it('never rounds a stored fraction: cents show as stored', () => {
    expect(boxText('6695.50', money)).toBe('6,695.50')
    expect(boxText('6695.5', money)).toBe('6,695.50')
    expect(boxText('10.505', money)).toBe('10.505')
  })

  it('leaves an empty box empty, and a box that is not money as stored', () => {
    expect(boxText(null, { ...money, nullable: true })).toBe('')
    expect(boxText('72.0', { ...money, unit: 'percent' })).toBe('72.0')
  })

  it('reads the commas back, and a box left as shown is no change', () => {
    expect(parseSetting('6,695', money)).toEqual({ kind: 'ok', value: '6695' })
    const cost = { tuition: { '1000101': '6695.0', '1000102': '6695.50' } }
    const specOf = (path: readonly string[]) => fieldSpec(path, valueAt(cost, path))
    const shown = (id: string) => {
      const spec = specOf(['tuition', id])
      return spec === null ? '' : boxText(valueAt(cost, ['tuition', id]), spec)
    }
    const applied = applyEdits(
      cost,
      new Map([
        [editKey(['tuition', '1000101']), shown('1000101')],
        [editKey(['tuition', '1000102']), shown('1000102')],
      ]),
      specOf
    )
    expect(applied.problems.size).toBe(0)
    expect(applied.changed).toEqual([])
    expect(applied.content).toEqual(cost)
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

  it("never offers a named award's kind: the server refuses a kind change", () => {
    for (const kind of ['full_cost', 'full_cost_after_aid', 'top_up', 'discretionary']) {
      expect(fieldSpec(['decision_types', 'd', 'kind'], kind)).toBeNull()
    }
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

const CONTEXT: EditContext = {
  classes: ['camp', 'teen', 'family'],
  pools: [
    { key: 'pool_a', label: 'Pool A' },
    { key: 'pool_b', label: 'Pool B' },
  ],
  sessions: [
    { id: 1000101, name: 'Session 1' },
    { id: 1000102, name: 'Session 2' },
    { id: 1000103, name: 'Session 3' },
  ],
  programs: [
    { key: 'summer', label: 'Summer' },
    { key: 'weekend', label: 'Weekend' },
  ],
  claimed: new Set([1000101]),
}

describe('the lifted settings (spec §6.2 F)', () => {
  it("boxes a program's class and pool as pickers with None, only when the editor has the context", () => {
    expect(fieldSpec(['summer', 'equity_class'], 'camp', {}, CONTEXT)).toEqual({
      kind: 'pick',
      options: [
        { value: 'camp', label: 'Camp' },
        { value: 'teen', label: 'Teen' },
        { value: 'family', label: 'Family' },
        { value: '', label: 'None' },
      ],
    })
    expect(fieldSpec(['summer', 'equity_class'], 'camp', {})).toBeNull() // Scenarios' All settings: unchanged
    expect(fieldSpec(['summer', 'budget_pool'], null, {}, CONTEXT)).toMatchObject({ kind: 'pick' })
  })

  it('offers a class by the program label that shares its key, else its words', () => {
    const spec = fieldSpec(
      ['summer', 'equity_class'],
      'camp',
      {},
      {
        ...CONTEXT,
        classLabels: new Map([['teen', 'Teen Program']]),
      }
    )
    expect(spec).toMatchObject({
      options: [
        { value: 'camp', label: 'Camp' },
        { value: 'teen', label: 'Teen Program' },
        { value: 'family', label: 'Family' },
        { value: '', label: 'None' },
      ],
    })
  })

  it("boxes sessions as chips, the grants offset as checkboxes, a criterion's Enabled and every date", () => {
    expect(fieldSpec(['summer', 'session_cm_ids'], [1000101], {}, CONTEXT)).toMatchObject({
      kind: 'sessions',
    })
    expect(fieldSpec(['offset_programs'], ['summer'], {}, CONTEXT)).toMatchObject({
      kind: 'programs',
    })
    expect(fieldSpec(['criteria', '0', 'enabled'], true, {}, CONTEXT)).toEqual({ kind: 'yesno' })
    expect(fieldSpec(['r1_run'], null, {}, CONTEXT)).toEqual({ kind: 'date' })
  })

  it('reads them back in the server form', () => {
    expect(parseSetting('', { kind: 'pick', options: [] })).toEqual({ kind: 'ok', value: null })
    expect(parseSetting('2027-03-01', { kind: 'date' })).toEqual({
      kind: 'ok',
      value: '2027-03-01',
    })
    expect(parseSetting('', { kind: 'date' })).toEqual({ kind: 'ok', value: null })
    expect(
      parseSetting('1000101,1000103', { kind: 'sessions', options: [], claimed: new Set() })
    ).toEqual({ kind: 'ok', value: [1000101, 1000103] })
    expect(parseSetting('summer', { kind: 'programs', options: [] })).toEqual({
      kind: 'ok',
      value: ['summer'],
    })
  })

  it('never lifts a name, a key, or a legacy table route', () => {
    expect(fieldSpec(['summer', 'r1_table'], 'camp', {}, CONTEXT)).toBeNull()
    expect(fieldSpec(['summer', 'label'], 'Summer', {}, CONTEXT)).toBeNull()
  })
})

describe('what each save writes (spec §6.2 F, §9.9)', () => {
  it('the programs save routes every program by class and drops r1_table', () => {
    const out = prepareContent(
      'programs',
      {
        summer: {
          label: 'Summer',
          r1_table: 'general',
          equity_class: 'camp',
          table_from_equity_class: false,
        },
      },
      RULES_DOCUMENT
    )
    expect(out).toEqual({
      summer: { label: 'Summer', equity_class: 'camp', table_from_equity_class: true },
    })
  })

  it('the appeal caps save writes an empty program map once every program is by class', () => {
    const document = {
      ...RULES_DOCUMENT,
      programs: {
        summer: { ...RULES_DOCUMENT.programs['summer']!, table_from_equity_class: true },
      },
    }
    expect(
      prepareContent(
        'round2',
        { ...RULES_DOCUMENT.round2, program_tables: { summer: 'general' } },
        document
      )['program_tables']
    ).toEqual({})
    expect(
      prepareContent(
        'round2',
        { ...RULES_DOCUMENT.round2, program_tables: { summer: 'general' } },
        RULES_DOCUMENT
      )['program_tables']
    ).toEqual({ summer: 'general' })
  })

  it('the income save sends no current-year weight: the server derives it', () => {
    const out = prepareContent(
      'income',
      { weights: { prior_year: '0.6', current_year: '0.3' }, basis: 'gross' },
      RULES_DOCUMENT
    )
    expect(out['weights']).toEqual({ prior_year: '0.6' })
  })

  it('the equity save sends the full weight matrix, zeros included', () => {
    const out = prepareContent(
      'equity',
      { criteria: [{ key: 'a' }, { key: 'b' }], weights: { camp: { a: '0.5' }, family: {} } },
      RULES_DOCUMENT
    )
    expect(out['weights']).toEqual({ camp: { a: '0.5', b: '0' }, family: { a: '0', b: '0' } })
  })
})
