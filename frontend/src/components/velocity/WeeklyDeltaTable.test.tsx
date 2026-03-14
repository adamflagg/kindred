import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WeeklyDeltaTable } from './WeeklyDeltaTable'
import type { WeeklyDataPoint } from '../../types/velocity'

function makeWeek(overrides: Partial<WeeklyDataPoint> = {}): WeeklyDataPoint {
  return {
    week_start: '2026-01-05',
    week_end: '2026-01-11',
    week_label: 'Jan 5 - Jan 11',
    week_number: 1,
    enrolled: 50,
    delta: 5,
    data_source: 'snapshot',
    gross_enrolled: 55,
    weekly_new: 10,
    weekly_cancelled: 5,
    is_partial: false,
    days_in_week: 7,
    enrolled_boys: null,
    enrolled_girls: null,
    gross_enrolled_boys: null,
    gross_enrolled_girls: null,
    weekly_new_boys: null,
    weekly_new_girls: null,
    weekly_cancelled_boys: null,
    weekly_cancelled_girls: null,
    ...overrides,
  }
}

describe('WeeklyDeltaTable', () => {
  const defaultColumns = [
    {
      header: 'Change',
      accessor: (week: WeeklyDataPoint) => week.delta,
      className: 'text-right',
    },
    {
      header: 'Total',
      accessor: (week: WeeklyDataPoint) => week.enrolled,
      className: 'text-right',
    },
  ]

  const defaultProps = {
    weeks: [makeWeek()],
    priorWeekMap: null as Map<number, WeeklyDataPoint> | null,
    columns: defaultColumns,
  }

  it('renders table headers from columns prop', () => {
    render(<WeeklyDeltaTable {...defaultProps} />)
    expect(screen.getByText('Week')).toBeInTheDocument()
    expect(screen.getByText('Change')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('renders one row per week', () => {
    const weeks = [
      makeWeek({ week_number: 1, week_label: 'Week One' }),
      makeWeek({ week_number: 2, week_label: 'Week Two', week_start: '2026-01-12' }),
    ]
    render(<WeeklyDeltaTable {...defaultProps} weeks={weeks} />)
    expect(screen.getByText('Week One')).toBeInTheDocument()
    expect(screen.getByText('Week Two')).toBeInTheDocument()
  })

  it('shows week label from week data', () => {
    const weeks = [makeWeek({ week_label: 'Jan 5 - Jan 11' })]
    render(<WeeklyDeltaTable {...defaultProps} weeks={weeks} />)
    expect(screen.getByText('Jan 5 - Jan 11')).toBeInTheDocument()
  })

  it('highlights partial weeks with amber background', () => {
    const weeks = [makeWeek({ is_partial: true, days_in_week: 4 })]
    render(<WeeklyDeltaTable {...defaultProps} weeks={weeks} />)
    const row = screen.getByText('Jan 5 - Jan 11').closest('tr')
    expect(row).toHaveClass('bg-amber-50/50')
  })

  it('shows partial week indicator text', () => {
    const weeks = [makeWeek({ is_partial: true, days_in_week: 4 })]
    render(<WeeklyDeltaTable {...defaultProps} weeks={weeks} />)
    expect(screen.getByText('(4/7 days)')).toBeInTheDocument()
  })

  it('renders phase badge when phaseByWeek provided', () => {
    const phaseByWeek = new Map([[1, { phase: 'priority', label: 'Priority Registration' }]])
    render(<WeeklyDeltaTable {...defaultProps} phaseByWeek={phaseByWeek} />)
    expect(screen.getByText('Priority')).toBeInTheDocument()
  })

  it('shows empty message when no weeks', () => {
    render(<WeeklyDeltaTable {...defaultProps} weeks={[]} />)
    expect(screen.getByText('No weekly data available')).toBeInTheDocument()
  })

  it('calls column accessors with week data', () => {
    const accessor = vi.fn(() => 'computed-value')
    const columns = [{ header: 'Custom', accessor }]
    const week = makeWeek()
    render(<WeeklyDeltaTable {...defaultProps} weeks={[week]} columns={columns} />)
    expect(accessor).toHaveBeenCalledWith(week, undefined)
    expect(screen.getByText('computed-value')).toBeInTheDocument()
  })

  it('passes prior week data to column accessors when available', () => {
    const accessor = vi.fn(
      (_week: WeeklyDataPoint, priorWeek?: WeeklyDataPoint) =>
        priorWeek?.enrolled.toString() ?? 'no-prior'
    )
    const columns = [{ header: 'Prior', accessor }]
    const week = makeWeek({ week_number: 1 })
    const priorWeek = makeWeek({ week_number: 1, enrolled: 42 })
    const priorWeekMap = new Map<number, WeeklyDataPoint>([[1, priorWeek]])
    render(
      <WeeklyDeltaTable
        {...defaultProps}
        weeks={[week]}
        columns={columns}
        priorWeekMap={priorWeekMap}
      />
    )
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('applies className from column definitions', () => {
    const columns = [
      {
        header: 'Value',
        accessor: () => '99',
        className: 'text-right',
      },
    ]
    render(<WeeklyDeltaTable {...defaultProps} columns={columns} />)
    const cell = screen.getByText('99')
    expect(cell.closest('td')).toHaveClass('text-right')
  })
})
