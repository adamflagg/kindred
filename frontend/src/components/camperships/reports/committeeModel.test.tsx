/** The committee's tables in words (spec §9.7; D155; owner N2; approved final mock reports-yoy.html). */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { reportCsv, reportText } from '../kit/report'
import { COMMITTEE } from './committeeFixtures'
import {
  appealsColumns,
  appealsRows,
  applicationColumns,
  applicationRows,
  applicationsUnder,
  budgetColumns,
  budgetRows,
  committeeCsvName,
  committeeHeading,
  overUnderWords,
  parsePhaseShare,
  parsePools,
  phaseColumns,
  phaseLabels,
  phaseRows,
  reconciliationWords,
  seasonWords,
} from './committeeModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)
const noteOf = (key: string) =>
  ({
    finance_budget: 1,
    committee_awarded: 2,
    committee_apps: 3,
    as_reported: 4,
    round1_phases: 5,
    committee_appeals: 6,
  })[key] ?? null
/** What a cell's `display` draws, as text (the mark, the pill). */
const drawn = (cell: Parameters<typeof reportText>[0] | undefined) => {
  const { container } = render(<>{cell?.display}</>)
  return container.textContent
}

describe('the phase table (RPT-1; owner N2)', () => {
  it('draws 14 columns, each phase under its numbered group, notes on the Season, Budget and first group', () => {
    const columns = phaseColumns('budget', noteOf)
    expect(columns).toHaveLength(14)
    expect(columns.map((c) => c.header)).toEqual([
      'Season',
      ...[0, 1, 2].flatMap(() => ['As offered', 'End of season', '% of budget']),
      'End of season',
      '% of budget',
      'Budget',
      'Over / under',
    ])
    expect(columns.map((c) => c.group)).toEqual([
      undefined,
      ...[
        '1 · Round 1 by the deadline',
        '2 · Round 1 after the deadline',
        '3 · Appeals (Rounds 2 and 3)',
      ].flatMap((g) => [g, g, g]),
      'Total',
      'Total',
      '',
      '',
    ])
    expect(columns[0]?.note).toBe(4)
    expect(columns[1]?.groupNote).toBe(5)
    expect(columns[4]?.groupNote).toBeUndefined()
    expect(columns[12]?.note).toBe(1)
    const keys = columns.map((c) => c.key)
    expect(keys).toHaveLength(new Set(keys).size)
  })

  it('titles the three column kinds in the final mock words, and wraps the figure headers', () => {
    const columns = phaseColumns('budget', noteOf)
    expect(columns[1]?.title).toBe('The lock as posted; a later cancellation never reduces it')
    expect(columns[2]?.title).toBe(
      'Net of cancellations and clawback; "to date" until the season closes'
    )
    expect(columns[3]?.title).toBe(
      'End of season as a % of the budget. The mark compares As offered with the target band: ✓ in it, ↓ below, ↑ above (hover for the band).'
    )
    expect(columns[1]?.wrap).toBe(true)
    const share = phaseColumns('share', noteOf)
    expect(share[3]?.header).toBe('% of phases')
    expect(share[3]?.title).toBe(
      "Each phase's End of season as a share of the three phases (the deck's pie). Bands compare % of budget, so they hide here."
    )
  })

  it("reads each phase's % from End of season's, marked against the band on one line, the band in the title", () => {
    expect(parsePhaseShare(null)).toBe('budget')
    const row = phaseRows(COMMITTEE, 'budget')[0]
    expect(row?.cells).toHaveLength(14)
    expect(texts(row)).toEqual([
      '2026 · r',
      '$300,000',
      '$300,000',
      '60.0%',
      '—',
      '$100,000',
      '20.0%',
      '—',
      '$50,000',
      '10.0%',
      '$460,000',
      '92.0%',
      '$500,000',
      '$40,000 under',
    ])
    expect(drawn(row?.cells[3])).toBe('60.0%↑')
    expect(row?.cells[3]?.title).toBe(
      'End of season: 60.0% of the budget. Target band 51–55% compares As offered (60.0%): above'
    )
    // a phase with no band draws no mark and no title
    expect(row?.cells[6]).not.toHaveProperty('display')
    expect(row?.cells[6]).not.toHaveProperty('note')
    const below = phaseRows(COMMITTEE, 'budget')[1]
    expect(drawn(below?.cells[3])).toBe('0.3%↓')
  })

  it('marks ✓ when As offered is inside the band', () => {
    const within = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({
        ...row,
        bands: row.bands.map((b) => (b === null ? null : { ...b, position: 'within' as const })),
      })),
    }
    expect(drawn(phaseRows(within, 'budget')[0]?.cells[3])).toBe('60.0%✓')
  })

  it("switches every phase's % to the share of the phases, with no mark, never mixing the two", () => {
    const row = phaseRows(COMMITTEE, 'share')[0]
    expect(row?.cells[3]).toMatchObject({ value: 66.7 })
    expect(row?.cells[3]).not.toHaveProperty('display')
    expect(row?.cells[3]?.title).toBe("66.7% of the three phases' End of season sum")
    expect(row?.cells[6]).toMatchObject({ value: 22.2 })
    expect(row?.cells[11]).toMatchObject({ value: 92 })
  })

  it('draws the season as its year and a basis pill, keeping the words for Copy and the CSV', () => {
    const [past, now] = phaseRows(COMMITTEE, 'budget')
    expect(drawn(past?.cells[0])).toBe('2026r')
    expect(drawn(now?.cells[0])).toBe('2027P · to date')
    expect(texts(now)[0]).toBe('2027 · P · to date')
    expect(now?.cells[0]?.title).toBe("2027 · the dashboard's Posted · to date")
    expect(past?.cells[0]?.title).toBe('2026 · as reported')
    expect(seasonWords(2026, 'r')).toBe('2026 · r')
  })

  it("heads the phase columns with the read's own labels, today's words only with no row (owner N2)", () => {
    const relabelled = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({
        ...row,
        offered_label: 'Offered',
        end_of_season_label: 'Season end',
      })),
    }
    const headers = phaseColumns('budget', noteOf, phaseLabels(relabelled)).map((c) => c.header)
    expect(headers.slice(1, 4)).toEqual(['Offered', 'Season end', '% of budget'])
    expect(headers[10]).toBe('Season end')
    expect(phaseLabels({ ...COMMITTEE, phases: [] })).toEqual({
      offered: 'As offered',
      end: 'End of season',
    })
  })

  it('words the add-up check only for seasons whose total differs from the phases, in the final mock words', () => {
    expect(reconciliationWords(COMMITTEE)).toBe(
      'Total − Σ phases: 2026 $10,000. The typed total is more than its three phases, shown rather than hidden.'
    )
    const both = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: 1200 })),
    }
    expect(reconciliationWords(both)).toBe(
      'Total − Σ phases: 2026 $1,200 · 2027 $1,200. The typed total is more than its three phases, shown rather than hidden.'
    )
    const less = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: -500 })),
    }
    expect(reconciliationWords(less)).toContain('The typed total is less than its three phases')
    for (const value of [0, null]) {
      const none = {
        ...COMMITTEE,
        phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: value })),
      }
      expect(reconciliationWords(none)).toBeNull()
    }
  })

  it('states over and under in words, with one sign convention', () => {
    expect(overUnderWords(-40000, 'under')).toBe('$40,000 under')
    expect(overUnderWords(1200, 'over')).toBe('$1,200 over')
    expect(overUnderWords(0, 'on')).toBe('on budget')
    expect(overUnderWords(null, null)).toBe('—')
  })

  it('writes Over / under to the CSV as a plain signed number (under is negative), the words on screen', () => {
    const phase = phaseRows(COMMITTEE, 'budget')[0]
    expect(phase?.cells[13] && reportText(phase.cells[13])).toBe('$40,000 under')
    expect(phase?.cells[13] && reportCsv(phase.cells[13])).toBe('-40000')
  })
})

describe('the cutoff table (RPT-2, RPT-6)', () => {
  it('keeps four columns in the CSV only: 11 drawn of 15', () => {
    const columns = applicationColumns(noteOf)
    expect(columns).toHaveLength(15)
    expect(columns.filter((c) => c.csvOnly).map((c) => `${c.group ?? ''}|${c.header}`)).toEqual([
      'Received since|Avg ask',
      'Season end|Avg ask',
      'Season end|As of',
      'vs last year|Asked',
    ])
    expect(columns.filter((c) => !c.csvOnly)).toHaveLength(11)
    expect(columns.map((c) => c.header)).not.toContain('No received date')
    expect(columns[2]?.title).toBe(
      "The Round 1 deadline, or the date in Received through (this season only). A typed season shows the deck's date."
    )
    expect(columns[3]?.note).toBe(3)
  })

  it('draws one All pools row per season and cutoff, with no reconciliation row, the dates short', () => {
    const rows = applicationRows(COMMITTEE, 'all')
    expect(rows.map((r) => [r.kind, texts(r)[0], texts(r)[1]])).toEqual([
      ['body', '2026 · r', 'All pools'],
      ['body', '2027 · P · to date', 'All pools'],
    ])
    expect(texts(rows[1]).slice(0, 6)).toEqual([
      '2027 · P · to date',
      'All pools',
      'Feb 1',
      '2',
      '$6,000',
      '$3,000',
    ])
    expect(rows[1]?.cells).toHaveLength(15)
  })

  it('draws By pool as each pool then the All pools row as a band total, per season', () => {
    const rows = applicationRows(COMMITTEE, 'pool')
    expect(rows.map((r) => [r.kind, texts(r)[0], texts(r)[1]])).toEqual([
      ['body', '2026 · r', 'Pool A'],
      ['total', '2026 · r', 'All pools'],
      ['body', '2027 · P · to date', 'Pool A'],
      ['total', '2027 · P · to date', 'All pools'],
    ])
    expect(texts(rows[2])).toEqual([
      '2027 · P · to date',
      'Pool A',
      'Feb 1',
      '2',
      '$6,000',
      '$3,000',
      '0',
      '$0',
      '—',
      '2',
      '$6,000',
      '$3,000',
      'Apr 10',
      '—',
      '—',
    ])
  })

  it('shows an application average with cents in whole dollars', () => {
    const rows = applicationRows(
      {
        ...COMMITTEE,
        applications: COMMITTEE.applications.map((row) =>
          row.kind === 'headline' && row.year === 2027
            ? { ...row, at_cutoff: { ...row.at_cutoff!, average: 2744.44 } }
            : row
        ),
      },
      'all'
    )
    expect(texts(rows[1])).toContain('$2,744')
  })

  it('puts the "now" pill beside the ask that fell back to today’s (owner R2b D12), with the reason in its title', () => {
    const [, headline] = applicationRows(COMMITTEE, 'all')
    expect(drawn(headline?.cells[4])).toBe('$6,000now')
    expect(headline?.cells[4]?.title).toBe(
      'Asks as they stand now: one request was corrected after the deadline'
    )
    expect(headline?.note).toBeUndefined()
    const [pool] = applicationRows(COMMITTEE, 'pool').filter(
      (r) => texts(r)[0] === '2027 · P · to date'
    )
    expect(pool?.cells[4]).not.toHaveProperty('display')
  })

  it('says under the table, only when non-zero, what the pools and the received dates leave out', () => {
    expect(applicationsUnder(COMMITTEE)).toBe(
      '2026: the typed pools add up to 14 apps and $38,000 less than the headline, shown rather than hidden · 2027: 3 requests have no received date (in Season end, not at the cutoff).'
    )
    const clean = {
      ...COMMITTEE,
      applications: COMMITTEE.applications
        .filter((r) => r.kind !== 'reconciliation')
        .map((r) => ({ ...r, unknown_received: 0 })),
    }
    expect(applicationsUnder(clean)).toBeNull()
  })
})

describe('the budget table (RPT-7, RPT-24)', () => {
  it('keeps Pool share and the rules split in the CSV only, and gives the Note its title', () => {
    const columns = budgetColumns(noteOf)
    expect(columns.map((c) => c.header)).toEqual([
      'Season',
      'Pool',
      'Budget',
      'Awarded',
      'Over / under',
      '% of budget',
      'Pool share',
      'Rules split (a reference)',
      'Note',
    ])
    expect(columns.filter((c) => c.csvOnly).map((c) => c.key)).toEqual(['share', 'split'])
    expect(columns.map((c) => c.width)).toEqual([
      128,
      150,
      112,
      112,
      134,
      96,
      undefined,
      undefined,
      undefined,
    ])
    expect(columns[8]?.title).toBe("Finance's note on the budget, typed with the season")
    expect(columns[2]?.note).toBe(1)
    expect(columns[3]?.note).toBe(2)
  })

  it('draws a past season as one All pools row and this season as its pools then a band total', () => {
    const rows = budgetRows(COMMITTEE, 'all')
    expect(rows.map((r) => [r.kind, texts(r)[0], texts(r)[1]])).toEqual([
      ['body', '2026 · r', 'All pools'],
      ['body', '2027 · P · to date', 'Pool A'],
      ['total', '2027 · P · to date', 'All pools'],
    ])
    expect(texts(rows[0])).toEqual([
      '2026 · r',
      'All pools',
      '$500,000',
      '$460,000',
      '$40,000 under',
      '92.0%',
      '—',
      '—',
      'first board-approved budget',
    ])
  })

  it('indents a pool name under its season, and not the all-pools total', () => {
    const rows = budgetRows(COMMITTEE, 'pool')
    const classOf = (cell: Parameters<typeof reportText>[0] | undefined) =>
      render(<>{cell?.display}</>).container.firstElementChild?.className
    expect(classOf(rows[0]?.cells[1])).toContain('pl-4')
    expect(classOf(rows[1]?.cells[1])).not.toContain('pl-4')
  })

  it('draws By pool every season by pool', () => {
    expect(budgetRows(COMMITTEE, 'pool').map((r) => [r.kind, texts(r)[0], texts(r)[1]])).toEqual([
      ['body', '2026 · r', 'Pool A'],
      ['total', '2026 · r', 'All pools'],
      ['body', '2027 · P · to date', 'Pool A'],
      ['total', '2027 · P · to date', 'All pools'],
    ])
  })

  it('writes Over / under to the CSV as a plain signed number', () => {
    const budget = budgetRows(COMMITTEE, 'all')[0]
    expect(budget?.cells[4] && reportCsv(budget.cells[4])).toBe('-40000')
  })
})

describe('appeals and % of ask in Round 1, merged', () => {
  it('draws the all-pools columns, the raw R1 asked in the CSV only', () => {
    const columns = appealsColumns(noteOf, 'all')
    expect(columns.map((c) => c.header)).toEqual([
      'Season',
      'Applications',
      'Appeals',
      'Appeal rate',
      'R1 awarded',
      'R1 asked',
      'R1 asked (in budget)',
      '% of ask in R1',
    ])
    expect(columns.filter((c) => c.csvOnly).map((c) => c.header)).toEqual(['R1 asked'])
    expect(columns.map((c) => c.note ?? null)).toEqual([null, 3, 6, null, 2, null, null, null])
    expect(columns[3]?.title).toBe('Appeals ÷ applications')
    expect(columns[6]?.title).toBe(
      "The live requests' Round 1 asks, leaving out a round paid wholly by an outside funder: % of ask divides by this"
    )
    expect(columns[7]?.title).toBe('R1 awarded ÷ R1 asked (in budget)')
    expect(appealsColumns(noteOf, 'pool').map((c) => c.header)[1]).toBe('Pool')
  })

  it('draws one row per season, a season with no R1 figures as dashes, a real 0% rate kept', () => {
    expect(appealsRows(COMMITTEE, 'all').map(texts)).toEqual([
      ['2026 · r', '520', '104', '20.0%', '$847,000', '$1,355,800', '$1,322,000', '64.1%'],
      ['2027 · P · to date', '2', '0', '0.0%', '$1,500', '$7,000', '$6,000', '25.0%'],
    ])
    const bare = appealsRows({ ...COMMITTEE, round1_pct: [] }, 'all')
    expect(texts(bare[0]).slice(4)).toEqual(['—', '—', '—', '—'])
  })

  it("draws By pool this season's pool rows with the appeal cells blank, then the All pools band total; a typed season says so", () => {
    const rows = appealsRows(COMMITTEE, 'pool')
    expect(rows.map((r) => [r.kind, texts(r)[0], texts(r)[1]])).toEqual([
      ['body', '2026 · r', 'All pools'],
      ['body', '2027 · P · to date', 'Pool A'],
      ['total', '2027 · P · to date', 'All pools'],
    ])
    expect(texts(rows[1])).toEqual([
      '2027 · P · to date',
      'Pool A',
      '',
      '',
      '',
      '$1,500',
      '$7,000',
      '$6,000',
      '25.0%',
    ])
    expect(rows[0]?.cells[1]?.title).toBe('A typed season carries the all-pools figure only')
    expect(texts(rows[2])[2]).toBe('2')
  })
})

describe('headings, file names and the URL', () => {
  it('heads each table on the mixed basis, and names the share and pool files apart from the default', () => {
    expect(committeeHeading(COMMITTEE, 'Appeals')).toMatchObject({
      title: 'Appeals',
      season: 2027,
      figuresOn: '2027-04-10',
    })
    const view = { year: 2027, asOf: { kind: 'live' } } as const
    expect(committeeCsvName(view, 'phases', 'share', 'all')).toBe(
      'camperships-reports-year-over-year-phases-share-of-phases-2027.csv'
    )
    expect(committeeCsvName(view, 'phases', 'budget', 'all')).toBe(
      'camperships-reports-year-over-year-phases-2027.csv'
    )
    expect(committeeCsvName(view, 'appeals', 'share', 'all')).toBe(
      'camperships-reports-year-over-year-appeals-2027.csv'
    )
    expect(committeeCsvName(view, 'budget', 'budget', 'pool')).toBe(
      'camperships-reports-year-over-year-budget-by-pool-2027.csv'
    )
    expect(committeeCsvName(view, 'phases', 'budget', 'pool')).toBe(
      'camperships-reports-year-over-year-phases-2027.csv'
    )
  })

  it('reads ?pools=pool, anything else is All pools', () => {
    expect(parsePools('pool')).toBe('pool')
    expect(parsePools(null)).toBe('all')
    expect(parsePools('x')).toBe('all')
  })
})

describe("Year over year's dividers, where the mock draws them (.bl)", () => {
  const divided = (columns: ReadonlyArray<{ key: string; divider?: 'before' | undefined }>) =>
    columns.filter((c) => c.divider === 'before').map((c) => c.key)

  it('divides each phase, the total and the budget in RPT-1', () => {
    expect(divided(phaseColumns('budget', () => null))).toEqual([
      'p0-offered',
      'p1-offered',
      'p2-offered',
      'total',
      'budget',
    ])
  })

  it('divides the cutoff, received-since, season-end and change blocks in RPT-2/6', () => {
    expect(divided(applicationColumns(() => null))).toEqual([
      'cutApps',
      'sinceApps',
      'endApps',
      'changeApps',
    ])
  })

  it("divides the budget's figures from the pool, the share and the note in RPT-7/24", () => {
    expect(divided(budgetColumns(() => null))).toEqual(['budget', 'share', 'note'])
  })

  it('divides the figures from the season in the merged table', () => {
    expect(divided(appealsColumns(() => null, 'all'))).toEqual(['applications', 'r1Awarded'])
  })
})
