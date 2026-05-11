import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SweepPanel } from './SweepPanel'

const fakeSessions = [
  { id: '1', cm_id: 1, name: 'Session 1', year: 2026 },
  { id: '2', cm_id: 2, name: 'Session 2', year: 2026 },
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

  it('associates form labels with their controls', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    // Each label resolves to a real form control via htmlFor/id linkage.
    expect(screen.getByLabelText(/^Session$/i).tagName).toBe('SELECT')
    expect(screen.getByLabelText(/^Source$/i).tagName).toBe('SELECT')
    expect(screen.getByLabelText(/Label \(optional\)/i).tagName).toBe('INPUT')
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

  it('disables the run button while a sweep is in flight', () => {
    const onRunSweep = vi.fn()
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={onRunSweep}
        onCancelSweep={vi.fn()}
        inFlightSweep={{ sweep_id: 'sw_x', completed: 1, total: 4 }}
      />
    )
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /run sweep/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onRunSweep).not.toHaveBeenCalled()
  })

  it('disables the run button when no session is available', () => {
    const onRunSweep = vi.fn()
    render(
      <SweepPanel
        sessions={[]}
        scenarios={[]}
        onRunSweep={onRunSweep}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    const btn = screen.getByRole<HTMLButtonElement>('button', { name: /run sweep/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onRunSweep).not.toHaveBeenCalled()
  })

  it('resets source to production when session changes away from the scenarios session', () => {
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
    // Default session is Session 2 (cm_id 2). Pick scenario s1 (also session 2).
    fireEvent.change(screen.getByLabelText(/^Source$/i), { target: { value: 's1' } })
    expect(screen.getByLabelText<HTMLSelectElement>(/^Source$/i).value).toBe('s1')
    // Switch to Session 1 — scenario s1 belongs to session 2, so source must reset.
    fireEvent.change(screen.getByLabelText(/^Session$/i), { target: { value: '1' } })
    expect(screen.getByLabelText<HTMLSelectElement>(/^Source$/i).value).toBe('production')

    fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
    expect(onRunSweep).toHaveBeenCalledWith(expect.objectContaining({ session_id: 1 }))
    // Production payloads must NOT carry a stale scenario_id.
    const lastCall = onRunSweep.mock.calls[onRunSweep.mock.calls.length - 1]?.[0]
    expect(lastCall).not.toHaveProperty('scenario_id')
  })

  describe('budget editing', () => {
    let promptSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      promptSpy = vi.spyOn(window, 'prompt')
    })
    afterEach(() => {
      promptSpy.mockRestore()
    })

    it('rejects duplicate budget values', () => {
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
      promptSpy.mockReturnValueOnce('60') // 60 is already in DEFAULT_BUDGETS
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
      expect(onRunSweep).toHaveBeenCalledWith(
        expect.objectContaining({ time_budgets: [30, 60, 180, 300] })
      )
    })

    it('adds a new unique budget in sorted order', () => {
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
      promptSpy.mockReturnValueOnce('90')
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
      expect(onRunSweep).toHaveBeenCalledWith(
        expect.objectContaining({ time_budgets: [30, 60, 90, 180, 300] })
      )
    })
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

  it('shows per-budget timing detail when supplied', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={{
          sweep_id: 'sw_abc',
          completed: 1,
          total: 3,
          budgets: [
            { seconds: 30, walltime: 23.1, state: 'done' },
            { seconds: 60, walltime: null, state: 'running' },
            { seconds: 180, walltime: null, state: 'pending' },
          ],
        }}
      />
    )
    // Done budget shows formatted walltime; running shows running…; pending
    // can be present in the joined string too. Assert the meaningful parts.
    expect(screen.getByText(/30s done in 23\.1s/)).toBeInTheDocument()
    expect(screen.getByText(/60s running/)).toBeInTheDocument()
  })

  it('still shows the simple "X of N" headline when budgets is omitted', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={{ sweep_id: 'sw_xyz', completed: 1, total: 4 }}
      />
    )
    expect(screen.getByText(/1 of 4/)).toBeInTheDocument()
    // Per-budget detail must not appear when there's no budgets array.
    expect(screen.queryByText(/done in/)).not.toBeInTheDocument()
  })

  it('shows a placeholder banner when total is 0 (sweep accepted, no rows yet)', () => {
    // Backend has accepted the sweep but the first solver_runs row hasn't
    // landed in the polled fetch yet. Banner must still show so the user
    // doesn't re-click and trip the 409 single-flight guard.
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={{ sweep_id: 'sw_kickoff', completed: 0, total: 0 }}
      />
    )
    expect(screen.getByText(/sw_kickoff/i)).toBeInTheDocument()
    // Must NOT show the misleading "0 of 0 complete" copy.
    expect(screen.queryByText(/0 of 0/i)).not.toBeInTheDocument()
    // Must show a kickoff indicator that's distinguishable from steady-state.
    expect(screen.getByText(/^— spinning up…$/)).toBeInTheDocument()
    // Run Sweep button must be disabled — that's the whole point of the
    // immediate placeholder.
    const runBtn = screen.getByRole<HTMLButtonElement>('button', { name: /run sweep/i })
    expect(runBtn).toBeDisabled()
  })
})
