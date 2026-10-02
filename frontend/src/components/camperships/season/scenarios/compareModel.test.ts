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

  it('refuses a fifth tick (the tab says so), keeps the four, and unticks', () => {
    const full = ['A', 'A1', 'B', 'B1']
    expect(toggleCode(full, 'B2')).toBe(full)
    expect(toggleCode(full, 'B1')).toEqual(['A', 'A1', 'B'])
    expect(toggleCode(['A', 'A1'], 'A')).toEqual(['A1'])
    expect(toggleCode(['A'], 'A1')).toEqual(['A', 'A1'])
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
    expect(rows.map((r) => r.label).slice(0, 2)).toEqual(['Tier 1', 'Tier 2'])
    expect(rows[1]?.cells[0]?.text).toBe('$383,800 · 63.1% of ask')
    expect(tierRows([null], 2)).toEqual([])
  })

  it('says what the tier rows leave out: held requests and Round 1 no tier holds', () => {
    const views = columns.map((c) => c.committee ?? null)
    const rows = tierRows(views, 1)
    expect(rows.map((r) => r.label)).toEqual(['Tier 1', 'Tier 2', 'Held', 'In no tier'])
    expect(rows.map((r) => r.informational ?? false)).toEqual([false, false, true, true])
    // 3 + 1 held, $6,000 + $1,500 asked: counted apart, out of the tier money and pct of ask.
    expect(rows.find((r) => r.key === 'r1:held')?.cells[0]?.text).toBe('4 · $7,500 asked')
    expect(rows.find((r) => r.key === 'r1:none')?.cells.map((c) => c.text)).toEqual([
      '$1,200',
      '$1,200',
    ])
  })

  it('leaves the held and in-no-tier rows out when every column holds none', () => {
    const quiet = compareOut().columns.map((c) => {
      const view = c.committee
      if (!view) throw new Error('the fixture has committees')
      return {
        ...view,
        not_in_tiers: 0,
        round1_by_tier: view.round1_by_tier.map((r) => ({ ...r, held: 0, held_asked: 0 })),
      }
    })
    expect(tierRows(quiet, 1).map((r) => r.label)).toEqual(['Tier 1', 'Tier 2'])
  })

  it('does the same for Round 2: appeals held apart, and Round 2 no tier holds', () => {
    const views = columns.map((c) =>
      c.committee
        ? {
            ...c.committee,
            round2_not_in_tiers: 300,
            round2_by_tier: c.committee.round2_by_tier.map((r) => ({ ...r })),
          }
        : null
    )
    const rows = tierRows(views, 2)
    // Worded as Round 1's: "Held", "$X asked" (Round2CompareOut has no held count).
    expect(rows.map((r) => r.label)).toEqual(['Tier 1', 'Held', 'In no tier'])
    expect(rows.find((r) => r.key === 'r2:held')?.cells[0]?.text).toBe('$2,000 asked')
    // What the tiers leave out is informational: never drawn as if summed into them.
    expect(rows.map((r) => r.informational ?? false)).toEqual([false, true, true])
    expect(rows.find((r) => r.key === 'r2:none')?.cells[0]?.text).toBe('$300')
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
