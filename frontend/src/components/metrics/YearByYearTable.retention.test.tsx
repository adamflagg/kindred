/**
 * Trends › Year-by-Year gains Retention and Retention change (#3207 PR 11, ruling #90): after the
 * existing columns, in the sort and the CSV; the live row reads "to date" against the year before
 * at the same registration day; every other row final to final.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RetentionTrendsResponse, YearMetrics } from '../../types/metrics'
import { YearByYearTable } from './YearByYearTable'
import { buildYearRows } from './yearByYearRows'

function y(year: number, total: number): YearMetrics {
  return {
    year,
    total_enrolled: total,
    by_gender: [{ gender: 'Girl/woman', count: total, percentage: 100 }],
    new_vs_returning: { new_count: 10, returning_count: total - 10, new_percentage: 10 },
    total_cancelled: 5,
    cancellation_rate: 1.2,
    has_cancellation_data: true,
  } as YearMetrics
}

const YEARS = [y(2023, 2000), y(2024, 2040), y(2025, 2080), y(2026, 1927)]
const LIVE = { year: 2026, priorYear: 2025, priorTotal: 1965, asOf: '2025-10-16', pending: false }

const t = (from: number, rate: number, samePoint: number | null = null) => ({
  from_year: from,
  to_year: from + 1,
  retention_rate: rate,
  base_count: 1000,
  returned_count: Math.round(rate * 1000),
  by_gender: [],
  by_grade: [],
  same_point_rate: samePoint,
})

const RETENTION_LIVE: RetentionTrendsResponse = {
  years: [
    t(2022, 0.689, 0.608),
    t(2023, 0.697, 0.619),
    t(2024, 0.706, 0.627),
    t(2025, 0.655, 0.655),
  ],
  prior_basis: 'same_point',
  as_of_date: '2025-10-16',
  day_offset: -27,
  prior_day_offset: -27,
}
const RETENTION_FINAL: RetentionTrendsResponse = {
  years: [t(2022, 0.689), t(2023, 0.697), t(2024, 0.706), t(2025, 0.712)],
  prior_basis: 'final',
}

describe('buildYearRows retention (#90)', () => {
  it('reads each year final against the year before, the oldest with nothing to compare', () => {
    const rows = buildYearRows(YEARS, null, RETENTION_FINAL)
    expect(rows.map((r) => r.retention)).toEqual(
      [68.9, 69.7, 70.6, 71.2].map((v) => expect.closeTo(v, 5))
    )
    expect(rows[0]!.retentionChange).toBeNull()
    expect(rows[1]!.retentionChange).toBeCloseTo(0.8, 5)
    expect(rows[3]!.retentionChange).toBeCloseTo(0.6, 5)
  })

  it('reads the live year against the year before at the same registration day', () => {
    const rows = buildYearRows(YEARS, LIVE, RETENTION_LIVE)
    const live = rows.find((r) => r.year === 2026)!
    expect(live.retention).toBeCloseTo(65.5, 5)
    expect(live.retentionChange).toBeCloseTo(65.5 - 62.7, 5)
    expect(live.retentionBasis).toBe('same point')
    expect(rows.find((r) => r.year === 2025)!.retentionChange).toBeCloseTo(0.9, 5)
  })

  it('leaves a year with no transition blank', () => {
    const rows = buildYearRows([y(2021, 1900), ...YEARS], null, RETENTION_FINAL)
    expect(rows[0]!.retention).toBeNull()
  })
})

describe('YearByYearTable retention columns', () => {
  it('heads them Retention and Retention change, after the existing columns', () => {
    render(<YearByYearTable years={YEARS} live={null} retention={RETENTION_FINAL} />)
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent.replace(/[↕↑↓]/g, ''))
    expect(headers.slice(-3)).toEqual(['Cancel %3', 'Retention4', 'Retention change'])
    const row = screen.getByText('2024').closest('tr')!
    expect(within(row).getByText('69.7%')).toBeInTheDocument()
    expect(within(row).getByText('▲ +0.8 pts')).toBeInTheDocument()
  })

  it('says Retention is not the Returning column', () => {
    render(<YearByYearTable years={YEARS} live={null} retention={RETENTION_FINAL} />)
    const note = screen.getByText(/Not the Returning column/)
    expect(note.closest('li')).toHaveTextContent(/^4\./)
  })

  it('marks the live row "to date", with the live note after the Retention note', () => {
    render(<YearByYearTable years={YEARS} live={LIVE} retention={RETENTION_LIVE} />)
    const liveRow = screen.getByText('2026').closest('tr')!
    expect(within(liveRow).getByText('to date')).toBeInTheDocument()
    expect(within(liveRow).getByText('▲ +2.8 pts')).toBeInTheDocument()
    expect(within(liveRow).getAllByText('5', { selector: 'sup' }).length).toBeGreaterThan(0)
    const note = screen.getByText(/2026 is still registering/)
    expect(note.closest('li')).toHaveTextContent(/^5\./)
    expect(note.textContent).toContain(
      "Its retention is today's, against 2025's on that day (62.7%) rather than 2025's final (70.6%)."
    )
  })

  it('sorts by Retention and writes both columns into the CSV, blank while pending', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    render(
      <YearByYearTable years={YEARS} live={{ ...LIVE, pending: true }} retention={RETENTION_LIVE} />
    )
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')?.firstChild?.textContent)
    fireEvent.click(screen.getByRole('button', { name: /^Retention4/ }))
    expect(order()).toEqual(['2025', '2024', '2023', '2026'])
    // both the count change and the retention change wait a day on the live row
    const liveRow = screen.getByText('2026').closest('tr')!
    expect(within(liveRow).getAllByText('updates tomorrow')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /^copy/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const tsv = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]
    const [head, ...lines] = tsv.split('\n')
    expect(head!.split('\t').slice(-2)).toEqual(['Retention %', 'Retention change pts'])
    const live = lines.find((l) => l.startsWith('2026'))!.split('\t')
    expect(live.slice(-2)).toEqual(['65.5', ''])
    const y2024 = lines.find((l) => l.startsWith('2024'))!.split('\t')
    expect(y2024.slice(-2)).toEqual(['69.7', '0.8'])
  })
})
