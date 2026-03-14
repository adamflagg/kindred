import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionBreakdownTable } from './SessionBreakdownTable'
import type { VelocityCurve, PriorYearSessionSummary } from '../../types/velocity'

// Minimal VelocityCurve data for testing
function makeSession(overrides: Partial<VelocityCurve> = {}): VelocityCurve {
  return {
    year: 2026,
    session_cm_id: 1000001,
    session_name: 'Session 1',
    gender: null,
    daily: [],
    weekly: [
      {
        week_start: '2026-01-05',
        week_end: '2026-01-11',
        week_label: 'Wk 1',
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
      },
    ],
    ...overrides,
  }
}

describe('SessionBreakdownTable', () => {
  const defaultColumns = [
    {
      header: 'Session',
      accessor: (session: VelocityCurve) =>
        session.session_name ?? `Session ${session.session_cm_id}`,
    },
    {
      header: 'Enrolled',
      accessor: (session: VelocityCurve) => {
        const last = session.weekly[session.weekly.length - 1]
        return last?.enrolled?.toLocaleString() ?? '-'
      },
      className: 'text-right',
    },
    {
      header: 'Weeks',
      accessor: (session: VelocityCurve) => session.weekly.length,
      className: 'text-right',
    },
  ]

  const defaultProps = {
    sortedBySession: [makeSession()],
    priorSessionMap: new Map<string, PriorYearSessionSummary>(),
    columns: defaultColumns,
  }

  it('renders table headers from columns prop', () => {
    render(<SessionBreakdownTable {...defaultProps} />)
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('Enrolled')).toBeInTheDocument()
    expect(screen.getByText('Weeks')).toBeInTheDocument()
  })

  it('renders one row per session', () => {
    const sessions = [
      makeSession({ session_cm_id: 1, session_name: 'Camp A' }),
      makeSession({ session_cm_id: 2, session_name: 'Camp B' }),
    ]
    render(<SessionBreakdownTable {...defaultProps} sortedBySession={sessions} />)
    expect(screen.getByText('Camp A')).toBeInTheDocument()
    expect(screen.getByText('Camp B')).toBeInTheDocument()
  })

  it('calls column accessors with correct data', () => {
    const accessor = vi.fn(() => 'test-value')
    const columns = [{ header: 'Test', accessor }]
    const session = makeSession()
    render(
      <SessionBreakdownTable {...defaultProps} sortedBySession={[session]} columns={columns} />
    )
    expect(accessor).toHaveBeenCalledWith(session, undefined)
    expect(screen.getByText('test-value')).toBeInTheDocument()
  })

  it('passes prior session data to column accessors', () => {
    const accessor = vi.fn(
      (_session: VelocityCurve, prior?: PriorYearSessionSummary) =>
        prior?.final_enrolled?.toString() ?? 'no-prior'
    )
    const columns = [{ header: 'Prior', accessor }]
    const session = makeSession({ session_name: 'Session 1' })
    const priorSessionMap = new Map<string, PriorYearSessionSummary>([
      [
        'Session 1',
        {
          year: 2025,
          session_name: 'Session 1',
          session_cm_id: 1000001,
          enrolled_at_current_week: 40,
          final_enrolled: 48,
        },
      ],
    ])
    render(
      <SessionBreakdownTable
        {...defaultProps}
        sortedBySession={[session]}
        columns={columns}
        priorSessionMap={priorSessionMap}
      />
    )
    expect(screen.getByText('48')).toBeInTheDocument()
  })

  it('shows empty message when sortedBySession is empty', () => {
    render(<SessionBreakdownTable {...defaultProps} sortedBySession={[]} />)
    expect(screen.getByText('No session data available')).toBeInTheDocument()
  })

  it('applies className from column definitions', () => {
    const columns = [
      {
        header: 'Value',
        accessor: () => '42',
        className: 'text-right',
      },
    ]
    render(<SessionBreakdownTable {...defaultProps} columns={columns} />)
    const cell = screen.getByText('42')
    expect(cell.closest('td')).toHaveClass('text-right')
  })
})
