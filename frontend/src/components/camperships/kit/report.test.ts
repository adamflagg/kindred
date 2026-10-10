/** Reports' cells, Copy and CSV (spec §9.7 RPT-33; §11; D74). */
import { describe, expect, it } from 'vitest'

import {
  averageValue,
  BASIS_WORDS,
  copyText,
  countValue,
  csvLines,
  formatPct,
  headingLines,
  moneyValue,
  pctValue,
  reportCsv,
  reportText,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
} from './report'

const HEADING: ReportHeading = {
  title: 'By tier',
  season: 2027,
  figuresOn: '2027-04-10',
  live: true,
  basis: BASIS_WORDS.P,
}
const COLUMNS: ReportColumn[] = [
  { key: 'tier', header: 'Tier' },
  { key: 'apps', header: 'Apps', group: 'Round 1' },
  { key: 'awarded', header: 'Awarded', group: 'Round 1' },
  { key: 'pct', header: '% of ask' },
]
const ROWS: ReportRow[] = [
  {
    key: '1',
    kind: 'body',
    cells: [textValue('1'), countValue(1293), moneyValue(2399.72), pctValue(42.5)],
  },
  {
    key: 'total',
    kind: 'total',
    cells: [textValue('All'), countValue(0), moneyValue(null), pctValue(null)],
  },
]

describe('a cell', () => {
  it('shows "—" for nothing there and "0" or "$0" for a real zero (D74)', () => {
    expect(reportText(countValue(null))).toBe('—')
    expect(reportText(countValue(0))).toBe('0')
    expect(reportText(moneyValue(null))).toBe('—')
    expect(reportText(moneyValue(0))).toBe('$0')
    expect(formatPct(null)).toBe('—')
  })

  it('shows a percentage to the one decimal the server sent (§9.7)', () => {
    expect(reportText(pctValue(42.5))).toBe('42.5%')
    expect(reportText(pctValue(100))).toBe('100.0%')
  })

  it('writes plain signed numbers in the CSV, and nothing for "—" (§11)', () => {
    expect(reportCsv(moneyValue(-1200))).toBe('-1200')
    expect(reportCsv(moneyValue(2399.72))).toBe('2399.72')
    expect(reportCsv(countValue(1293))).toBe('1293')
    expect(reportCsv(pctValue(42.5))).toBe('42.5')
    expect(reportCsv(pctValue(null))).toBe('')
  })
})

describe('Copy and CSV carry the as-of and the basis (RPT-33)', () => {
  it('heads every copy with the table, the season, the as-of and the basis', () => {
    expect(headingLines(HEADING)).toEqual([
      'By tier',
      'Season 2027 · As of Apr 10, 2027 (live)',
      'Basis: P (awarded = Posted)',
    ])
  })

  it('names the request set when a reporting control is on (D138)', () => {
    expect(
      headingLines({ ...HEADING, live: false, requestSet: 'requests received through Feb 1, 2027' })
    ).toEqual([
      'By tier',
      'Season 2027 · As of Apr 10, 2027',
      'Basis: P (awarded = Posted)',
      'Counts only requests received through Feb 1, 2027',
    ])
  })

  it('copies values exactly as displayed, tab-separated, each header naming its group', () => {
    expect(copyText(HEADING, COLUMNS, ROWS).split('\n').slice(4)).toEqual([
      'Tier\tRound 1 · Apps\tRound 1 · Awarded\t% of ask',
      '1\t1,293\t$2,399.72\t42.5%',
      'All\t0\t—\t—',
    ])
  })

  it('writes the CSV with plain numbers and the link last (D15)', () => {
    const lines = csvLines(HEADING, COLUMNS, ROWS, '/aid/reports/statistics?year=2027')
    expect(lines.slice(4)).toEqual([
      ['Tier', 'Round 1 · Apps', 'Round 1 · Awarded', '% of ask'],
      ['1', '1293', '2399.72', '42.5'],
      ['All', '0', '', ''],
      [],
      ['Link', '/aid/reports/statistics?year=2027'],
    ])
  })
})

describe('exportOnly columns and heading notes (owner A3, 2026-10-09)', () => {
  const cols: ReportColumn[] = [
    { key: 'asked', header: 'Asked' },
    { key: 'typed', header: 'Asked (as typed)', exportOnly: true },
    { key: 'csv', header: 'Hidden', csvOnly: true },
  ]
  const rows: ReportRow[] = [
    { key: 'a', kind: 'body', cells: [moneyValue(100), moneyValue(150), moneyValue(7)] },
  ]
  const noted = { ...HEADING, notes: ['A first note.', 'A second note.'] }

  it('writes an exportOnly column to Copy and to the CSV, where csvOnly stays out of Copy', () => {
    const copy = copyText(HEADING, cols, rows)
    expect(copy).toContain('Asked\tAsked (as typed)')
    expect(copy).toContain('$100\t$150')
    expect(copy).not.toContain('Hidden')
    const csv = csvLines(HEADING, cols, rows, '/x')
    expect(csv).toContainEqual(['Asked', 'Asked (as typed)', 'Hidden'])
    expect(csv).toContainEqual(['100', '150', '7'])
  })

  it('appends each heading note as its own line, in Copy and in the CSV', () => {
    expect(headingLines(noted).slice(-2)).toEqual(['A first note.', 'A second note.'])
    expect(copyText(noted, cols, rows).split('\n')).toContain('A second note.')
    expect(csvLines(noted, cols, rows, '/x')).toContainEqual(['A second note.'])
    expect(headingLines(HEADING)).toHaveLength(3)
  })
})

describe('a cell with a note under its figure (R3)', () => {
  it('carries the note on any kind of value, and keeps it out of the text, Copy and the CSV', () => {
    const cell = { ...pctValue(60), note: '51–55%: above' }
    expect(cell.note).toBe('51–55%: above')
    expect(reportText(cell)).toBe('60.0%')
    expect(reportCsv(cell)).toBe('60.0')
    for (const kind of [moneyValue(5), countValue(5), textValue('x')]) {
      expect({ ...kind, note: 'n' }.note).toBe('n')
    }
    const rows: ReportRow[] = [{ key: 'a', kind: 'body', cells: [cell] }]
    const columns: ReportColumn[] = [{ key: 'pct', header: '%' }]
    expect(copyText(HEADING, columns, rows)).not.toContain('51–55%')
    expect(csvLines(HEADING, columns, rows, '/x').flat().join('|')).not.toContain('51–55%')
  })

  it('builds a pct with a note through pctValue', () => {
    expect(pctValue(60, '51–55%: above')).toEqual({ kind: 'pct', value: 60, note: '51–55%: above' })
    expect(pctValue(60)).toEqual({ kind: 'pct', value: 60 })
    expect(pctValue(null, undefined)).toEqual({ kind: 'pct', value: null })
  })
})

describe('averageValue', () => {
  it('shows an average in whole dollars, as the mocks do, on screen, in Copy and in the CSV', () => {
    expect(reportText(averageValue(2744.44))).toBe('$2,744')
    expect(reportText(averageValue(2480.52))).toBe('$2,481')
    expect(reportCsv(averageValue(2983.62))).toBe('2984')
    expect(reportText(averageValue(null))).toBe('—')
    expect(reportText(averageValue(undefined))).toBe('—')
  })
})

describe('textValue with its own CSV', () => {
  it('shows the words on screen and in Copy, and writes the plain signed number to the CSV (§11)', () => {
    const cell = textValue('$40,000 under', '-40000')
    expect(reportText(cell)).toBe('$40,000 under')
    expect(reportCsv(cell)).toBe('-40000')
    expect(reportCsv(textValue('Tier 1'))).toBe('Tier 1')
  })
})
