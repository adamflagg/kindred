import { describe, expect, it } from 'vitest'

import {
  bandsIn,
  bandsOf,
  countNote,
  evenOf,
  gridCell,
  gridClasses,
  gridOrdered,
  notedCells,
  gridColumns,
  rangeWords,
  tierLineWords,
  warnedCells,
} from './tierGrid'

describe('income tiers (spec §6.2 E.2; owner Q6)', () => {
  it('builds even bands with the +$1 edge: tier n starts at start + width × (n−1) + 1', () => {
    expect(bandsOf(0, 35000, 3)).toEqual([
      { lower: '0', upper: '35000' },
      { lower: '35001', upper: '70000' },
      { lower: '70001', upper: null },
    ])
  })

  it('finds the start, width and count of even bands, and none of hand-set ones', () => {
    expect(evenOf(bandsOf(0, 35000, 11))).toEqual({ start: 0, width: 35000, count: 11 })
    expect(
      evenOf([
        { lower: '0', upper: '30000' },
        { lower: '30001', upper: '70000' },
        { lower: '70001', upper: null },
      ])
    ).toBeNull()
  })

  it('says the one line, by hand or even, with or without a ceiling', () => {
    expect(tierLineWords(bandsOf(0, 35000, 11), null)).toBe(
      '$35,000 bands from $0 · 11 tiers · no income ceiling'
    )
    expect(
      tierLineWords(
        [
          { lower: '0', upper: '30000' },
          { lower: '30001', upper: null },
        ],
        '300000'
      )
    ).toBe('Bands set by hand from $0 · 2 tiers · income ceiling $300,000')
    expect(rangeWords({ lower: '350001', upper: null })).toBe('$350,001 and up')
    expect(rangeWords({ lower: '0', upper: '35000' })).toBe('$0 – $35,000')
  })

  it('notes what a changed count does to the tables (the mock words)', () => {
    expect(countNote(11, 12)).toBe(
      'Saving adds tier 12 to the Round 1 and appeal tables, empty: fill it in before approving.'
    )
    expect(countNote(11, 13)).toBe(
      'Saving adds tiers 12–13 to the Round 1 and appeal tables, empty: fill them in before approving.'
    )
    expect(countNote(11, 10)).toBe('Saving drops tier 11 from the Round 1 and appeal tables.')
    expect(countNote(11, 9)).toBe('Saving drops tiers 10–11 from the Round 1 and appeal tables.')
    expect(countNote(11, 11)).toBeNull()
  })
})

describe('the combined grid (spec §6.2 E.2)', () => {
  const tables = {
    camp: {
      inherits: null,
      tiers: { '1': { r1_pct: '90' }, '2': { r1_pct: '75' } },
      overrides: {},
    },
    teen: { inherits: 'camp', tiers: {}, overrides: { '2': { r1_pct: '70' } } },
    family: { inherits: 'camp', tiers: {}, overrides: {} },
  }

  it('one column per equity class, captioned its own, same as its parent, or with changes', () => {
    const label = (k: string) => ({ camp: 'Camp', teen: 'Teen', family: 'Family' })[k] ?? k
    expect(gridColumns(tables, ['camp', 'teen', 'family'], label)).toEqual([
      { table: 'camp', label: 'Camp', caption: 'its own' },
      { table: 'teen', label: 'Teen', caption: 'same as Camp, with changes' },
      { table: 'family', label: 'Family', caption: 'same as Camp' },
    ])
  })

  it('an inherited cell shows the parent value; an override its own; a missing tier "—"', () => {
    expect(gridCell(tables, 'family', 1, 'r1_pct')).toEqual({ value: '90', inherited: true })
    expect(gridCell(tables, 'teen', 2, 'r1_pct')).toEqual({ value: '70', inherited: false })
    expect(gridCell(tables, 'camp', 3, 'r1_pct')).toEqual({ value: null, inherited: false })
  })
})

it("orders the grid's classes by the programs' classes, then any other table", () => {
  const programs = {
    a: { equity_class: 'summer' },
    b: { equity_class: 'family' },
    c: { equity_class: null },
    d: { equity_class: 'summer' },
  }
  expect(gridClasses(programs, { teen: {}, family: {}, summer: {} })).toEqual([
    'summer',
    'family',
    'teen',
  ])
})

it('puts the table the others copy first, then the rest in their order (coordinator B6)', () => {
  // The source sorts last by program, so the programs' order alone would put it last.
  const programs = {
    alpha: { equity_class: 'basic' },
    beta: { equity_class: 'middle' },
    gamma: { equity_class: 'zenith' },
  }
  const tables = {
    basic: { inherits: 'zenith' },
    middle: { inherits: 'zenith' },
    zenith: { inherits: null },
  }
  expect(gridClasses(programs, tables)).toEqual(['zenith', 'basic', 'middle'])
})

it("reads the warned cells from value_cannot_bind paths, and a document band's open top", () => {
  const warned = warnedCells([
    { code: 'value_cannot_bind', path: 'award_tables.summer.tiers.3' },
    { code: 'other', path: 'award_tables.teen.tiers.1' },
  ])
  expect([...warned]).toEqual(['summer:3'])
  expect(bandsIn({ bands: [{ lower: '0', upper: '100' }, { lower: '101' }] })).toEqual([
    { lower: '0', upper: '100' },
    { lower: '101', upper: null },
  ])
})

describe('a note is neither a warning nor an error (B3)', () => {
  const cell = (severity: string, table: string, tier: number) => ({
    code: 'value_cannot_bind',
    severity,
    path: `award_tables.${table}.tiers.${String(tier)}`,
    message: `${table} ${String(tier)} ${severity}`,
  })
  const issues = [cell('note', 'alpha', 9), cell('warning', 'alpha', 3), cell('note', 'beta', 11)]

  it('marks ⚠ only on warned cells, and reads the noted cells with their messages', () => {
    expect([...warnedCells(issues)]).toEqual(['alpha:3'])
    expect([...notedCells(issues)]).toEqual([
      ['alpha:9', 'alpha 9 note'],
      ['beta:11', 'beta 11 note'],
    ])
  })

  it("leaves the notes out of the chip's list, whichever opened it", () => {
    expect(gridOrdered(issues, ['alpha', 'beta']).map((i) => i.message)).toEqual([
      'alpha 3 warning',
    ])
    expect(gridOrdered(issues, ['alpha', 'beta'], 'beta')).toEqual([])
  })
})
