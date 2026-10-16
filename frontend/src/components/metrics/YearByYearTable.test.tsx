import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { YearMetrics } from '../../types/metrics'
import { YearByYearTable } from './YearByYearTable'
import { buildYearRows } from './yearByYearRows'

function y(year: number, total: number, extra: Partial<YearMetrics> = {}): YearMetrics {
  return {
    year,
    total_enrolled: total,
    by_gender: [
      { gender: 'M', count: 40, percentage: 40 },
      { gender: 'F', count: total - 40, percentage: 60 },
    ],
    new_vs_returning: { new_count: 10, returning_count: total - 10, new_percentage: 10 },
    total_cancelled: 5,
    cancellation_rate: 1.2,
    has_cancellation_data: true,
    ...extra,
  } as YearMetrics
}

const YEARS = [y(2023, 2000), y(2024, 2040), y(2025, 2080), y(2026, 1927)]
const LIVE = { year: 2026, priorYear: 2025, priorTotal: 1965, asOf: '2026-10-15', pending: false }

describe('buildYearRows (#66, #67)', () => {
  it('compares every row final to final, the first row with nothing', () => {
    const rows = buildYearRows(YEARS, null)
    expect(rows.map((r) => r.change)).toEqual([null, 40, 40, -153])
    expect(rows.every((r) => r.basis !== 'same point')).toBe(true)
  })

  it('compares the live season with last year at the same registration day, others final to final', () => {
    const rows = buildYearRows(YEARS, LIVE)
    const live = rows.find((r) => r.year === 2026)!
    expect(live.change).toBe(1927 - 1965)
    expect(live.basis).toBe('same point')
    expect(rows.find((r) => r.year === 2025)!.change).toBe(40)
  })
})

describe('YearByYearTable', () => {
  it('shows number and percent in the change column, e.g. ▲ +40 (+2.0%)', () => {
    render(<YearByYearTable years={YEARS} live={null} />)
    const row = screen.getByText('2024').closest('tr')!
    expect(within(row).getByText(/▲ \+40 \(\+2\.0%\)/)).toBeInTheDocument()
  })

  it('numbers the notes in order, and marks the live row with the note stated in the brief', () => {
    render(<YearByYearTable years={YEARS} live={LIVE} />)
    const note = screen.getByText(
      /2026 is still registering, so it is compared with 2025 at the same registration day \(Oct 15\)\. Earlier rows compare final to final\./
    )
    expect(note.closest('li')).toHaveTextContent(/^4\./)
    const liveRow = screen.getByText('2026').closest('tr')!
    expect(within(liveRow).getByText('4', { selector: 'sup' })).toBeInTheDocument()
  })

  it('has no live note when every row is a final', () => {
    render(<YearByYearTable years={YEARS} live={null} />)
    expect(screen.queryByText(/still registering/)).not.toBeInTheDocument()
  })

  it('sorts a number column high to low first, then flips; the year column runs oldest first', () => {
    render(<YearByYearTable years={YEARS} live={null} />)
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')?.textContent)
    expect(order()).toEqual(['2023', '2024', '2025', '2026'])
    fireEvent.click(screen.getByRole('button', { name: /^Total/ }))
    expect(order()).toEqual(['2025', '2024', '2023', '2026'])
    fireEvent.click(screen.getByRole('button', { name: /^Total/ }))
    expect(order()).toEqual(['2026', '2023', '2024', '2025'])
  })

  it('offers Copy and Download CSV', () => {
    render(<YearByYearTable years={YEARS} live={null} />)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^copy/i })).toBeInTheDocument()
  })
})
