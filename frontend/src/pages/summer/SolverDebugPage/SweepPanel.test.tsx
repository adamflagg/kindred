import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SweepPanel } from './SweepPanel'

const fakeSessions = [
  { id: '1', cm_id: 1, session_name: 'Session 1', year: 2026, attendee_count: 104 },
  { id: '2', cm_id: 2, session_name: 'Session 2', year: 2026, attendee_count: 98 },
]
const fakeScenarios = [
  { id: 's1', name: 'what-if-strict-grades', session_id: 2 },
  { id: 's2', name: 'balanced-cabins-v3', session_id: 2 },
]

describe('SweepPanel', () => {
  it('renders Session and Source dropdowns with scenarios filtered to chosen session', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    expect(screen.getAllByRole('option', { name: /Session 1/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: /Session 2/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: /Production/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /what-if-strict-grades/i })).toBeInTheDocument()
  })

  it('calls onRunSweep with correct payload for production', () => {
    const onRunSweep = vi.fn()
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={onRunSweep}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
    // SweepPanel defaults to the last session in the list (Session 2, cm_id 2)
    expect(onRunSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 2,
        time_budgets: [30, 60, 180, 300],
      })
    )
  })

  it('shows in-flight banner with cancel button', () => {
    const onCancel = vi.fn()
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={onCancel}
        inFlightSweep={{ sweep_id: 'sw_abc', completed: 2, total: 4 }}
      />
    )
    expect(screen.getByText(/2 of 4/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledWith('sw_abc')
  })
})
