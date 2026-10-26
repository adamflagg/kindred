import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('on the priority date the live row reads "updates tomorrow", sorts with the blanks and leaves its CSV change empty', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    render(<YearByYearTable years={YEARS} live={{ ...LIVE, pending: true }} />)
    const order = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.querySelector('td')?.textContent)
    fireEvent.click(screen.getByRole('button', { name: /^vs final/ }))
    // 2026's hidden change (−38) would sort it above nothing; it sits with 2023's blank at the bottom.
    expect(order()).toEqual(['2024', '2025', '2023', '2026'])
    fireEvent.click(screen.getByRole('button', { name: /^vs final/ }))
    expect(order()).toEqual(['2024', '2025', '2023', '2026'])

    fireEvent.click(screen.getByRole('button', { name: /^copy/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const tsv = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0]
    const liveLine = tsv.split('\n').find((l) => l.startsWith('2026'))!
    expect(liveLine.split('\t').slice(2, 5)).toEqual(['', '', ''])
  })

  it('offers Copy and Download CSV', () => {
    render(<YearByYearTable years={YEARS} live={null} />)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^copy/i })).toBeInTheDocument()
  })
})

describe('YearByYearTable gender identity (#2898)', () => {
  const identity = (fallback: number) =>
    y(2024, 100, {
      gender_fallback_count: fallback,
      by_gender: [
        { gender: 'Girl/woman', count: 60, percentage: 60 },
        { gender: 'Boy/man', count: 40, percentage: 40 },
      ],
    })

  it('heads the table with the identity groups, not Male and Female', () => {
    render(<YearByYearTable years={[identity(0)]} live={null} />)
    expect(screen.getByRole('button', { name: /^Girl\/woman/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Male/ })).not.toBeInTheDocument()
  })

  it('numbers the Gender note after the column notes, and after the live row note', () => {
    const { unmount } = render(<YearByYearTable years={[identity(7)]} live={null} />)
    expect(screen.getByText(/gender identity from CampMinder/).closest('li')?.textContent).toMatch(
      /^4/
    )
    unmount()
    render(<YearByYearTable years={[identity(7), y(2026, 100)]} live={LIVE} />)
    expect(screen.getByText(/gender identity from CampMinder/).closest('li')?.textContent).toMatch(
      /^5/
    )
  })

  it('adds no Gender note when every camper answered', () => {
    render(<YearByYearTable years={[identity(0)]} live={null} />)
    expect(screen.queryByText(/gender identity from CampMinder/)).not.toBeInTheDocument()
  })
})

describe('YearByYearTable — a year with nobody enrolled', () => {
  const noCamp = y(2020, 0, {
    by_gender: [],
    new_vs_returning: {
      new_count: 0,
      returning_count: 0,
      new_percentage: 0,
      returning_percentage: 0,
    },
    total_cancelled: 1400,
    cancellation_rate: null,
  })
  const YEARS_WITH_GAP = [y(2019, 2000), noCamp, y(2021, 1800)]

  it('says No camp in the rate cell, never 100%, and keeps the real cancelled count', () => {
    render(<YearByYearTable years={YEARS_WITH_GAP} live={null} />)
    const row = screen.getByText('2020').closest('tr')!
    expect(within(row).getAllByText('No camp')).toHaveLength(1)
    expect(within(row).queryByText(/^100(\.0)?%$/)).not.toBeInTheDocument()
    expect(within(row).getByText('1,400')).toBeInTheDocument()
  })

  it('uses plainer words when the view is a single session or duration', () => {
    render(<YearByYearTable years={YEARS_WITH_GAP} live={null} scoped />)
    const row = screen.getByText('2020').closest('tr')!
    expect(within(row).getAllByText('None enrolled')).toHaveLength(1)
    expect(within(row).queryByText('No camp')).not.toBeInTheDocument()
  })

  it('leaves every other year as it was', () => {
    render(<YearByYearTable years={YEARS_WITH_GAP} live={null} />)
    const row = screen.getByText('2021').closest('tr')!
    expect(within(row).getByText('5')).toBeInTheDocument()
    expect(within(row).getByText('1.2%')).toBeInTheDocument()
    expect(within(row).queryByText('No camp')).not.toBeInTheDocument()
  })

  it('flags the row for the builder, with its cancelled count and no rate', () => {
    const rows = buildYearRows(YEARS_WITH_GAP, null)
    const row = rows.find((r) => r.year === 2020)!
    expect(row.noEnrollment).toBe(true)
    expect(row.cancelled).toBe(1400)
    expect(row.cancelPct).toBeNull()
    expect(rows.find((r) => r.year === 2021)!.noEnrollment).toBe(false)
  })
})
