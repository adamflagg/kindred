import { describe, expect, it } from 'vitest'

import { compareOut } from './scenarioFixtures'
import {
  lastSeasonHeading,
  parseCodes,
  parseRequestSet,
  requestSetParam,
  resultRows,
  settingRows,
  tierRows,
  toggleCode,
} from './compareModel'

describe('what the compare shows, in the URL (D15, D38, D138)', () => {
  it('reads at most four kept codes, in the order ticked', () => {
    expect(parseCodes('A1,B,B,zz,C2,D,E')).toEqual(['A1', 'B', 'C2', 'D'])
    expect(parseCodes(null)).toEqual([])
  })

  it('drops the oldest when a fifth is ticked, and unticks', () => {
    expect(toggleCode(['A', 'A1', 'B', 'B1'], 'B2')).toEqual(['A1', 'B', 'B1', 'B2'])
    expect(toggleCode(['A', 'A1'], 'A')).toEqual(['A1'])
  })

  it('reads the request set: the Round 1 deadline, a date, or every frozen request', () => {
    expect(parseRequestSet('deadline')).toEqual({ kind: 'deadline' })
    expect(parseRequestSet('2027-02-01')).toEqual({ kind: 'date', date: '2027-02-01' })
    expect(parseRequestSet('nonsense')).toEqual({ kind: 'all' })
    expect(requestSetParam({ kind: 'date', date: '2027-02-01' })).toBe('2027-02-01')
    expect(requestSetParam({ kind: 'all' })).toBeNull()
  })
})

describe('the compare rows (D38; RPT-17, RPT-32)', () => {
  const columns = compareOut().columns

  it('marks a setting changed against its own reference in amber', () => {
    const minimum = settingRows(columns).find((r) => r.key === 'minimum')
    expect(minimum?.cells.map((c) => [c.text, c.changed])).toEqual([
      ['$150', true],
      ['$100', false],
    ])
  })

  it('shows the results under their meanings, the draft first', () => {
    const rows = resultRows(columns)
    expect(rows.find((r) => r.key === 'round1')?.cells.map((c) => c.text)).toEqual([
      '$735,000',
      '$760,000',
    ])
    expect(rows.find((r) => r.key === 'updown')?.cells.map((c) => c.text)).toEqual([
      '▲12 ▼3',
      '▲0 ▼40',
    ])
    expect(rows.find((r) => r.key === 'pct_of_budget')?.cells.map((c) => c.text)).toEqual([
      '73.5%',
      '76%',
    ])
  })

  it("lays out each tier's money against what was asked, from the committee's All rows", () => {
    const rows = tierRows(
      columns.map((c) => c.committee ?? null),
      1
    )
    expect(rows.map((r) => r.label)).toEqual(['Tier 1', 'Tier 2'])
    expect(rows[1]?.cells[0]?.text).toBe('$385,000 · 61.2% of ask')
    expect(tierRows([null], 2)).toEqual([])
  })

  it("heads last season's column, or says it isn't loaded", () => {
    const last = compareOut().last_season
    if (!last) throw new Error('the fixture has last season')
    expect(lastSeasonHeading(last)).toBe('2026 as posted')
    expect(
      lastSeasonHeading({
        year: 2026,
        loaded: false,
        label: '2026 is not loaded yet',
        rules_version: null,
        view: null,
      })
    ).toBe('2026 is not loaded yet')
  })
})
