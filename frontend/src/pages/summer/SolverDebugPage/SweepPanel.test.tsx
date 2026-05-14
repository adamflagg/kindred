import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SweepPanel, type SweepPanelSession } from './SweepPanel'

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
    expect(screen.getByRole('option', { name: /^CM$/ })).toBeInTheDocument()
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
    it('rejects duplicate budget values entered in the inline input', () => {
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
      // Type 60 into the inline number input (already in DEFAULT_BUDGETS).
      const input = screen.getByLabelText<HTMLInputElement>(/add budget/i)
      fireEvent.change(input, { target: { value: '60' } })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
      expect(onRunSweep).toHaveBeenCalledWith(
        expect.objectContaining({ time_budgets: [30, 60, 180, 300] })
      )
    })

    it('adds a new unique budget in sorted order via the inline input', () => {
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
      const input = screen.getByLabelText<HTMLInputElement>(/add budget/i)
      fireEvent.change(input, { target: { value: '90' } })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
      expect(onRunSweep).toHaveBeenCalledWith(
        expect.objectContaining({ time_budgets: [30, 60, 90, 180, 300] })
      )
    })

    it('clears the input after a successful add', () => {
      render(
        <SweepPanel
          sessions={fakeSessions}
          scenarios={fakeScenarios}
          onRunSweep={vi.fn()}
          onCancelSweep={vi.fn()}
          inFlightSweep={null}
        />
      )
      const input = screen.getByLabelText<HTMLInputElement>(/add budget/i)
      fireEvent.change(input, { target: { value: '120' } })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      expect(input.value).toBe('')
    })

    it('ignores non-positive and non-numeric input', () => {
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
      const input = screen.getByLabelText<HTMLInputElement>(/add budget/i)
      fireEvent.change(input, { target: { value: '-5' } })
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
      })
      fireEvent.click(screen.getByRole('button', { name: /run sweep/i }))
      // Defaults unchanged.
      expect(onRunSweep).toHaveBeenCalledWith(
        expect.objectContaining({ time_budgets: [30, 60, 180, 300] })
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

  it('renders attendee count in session dropdown option (#1250)', () => {
    const sessions: SweepPanelSession[] = [
      { id: 'sess1', cm_id: 1001, name: 'Session 2', year: 2026, attendee_count: 142 },
    ]
    render(
      <SweepPanel
        sessions={sessions}
        scenarios={[]}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    // The option text should include "(142)"
    expect(screen.getByText(/\(142\)/)).toBeInTheDocument()
  })

  it('omits attendee count from option text when attendee_count is not provided (#1250)', () => {
    // SweepPanelSession.attendee_count is optional — older callers may omit it.
    const sessions: SweepPanelSession[] = [
      { id: 'sess1', cm_id: 1001, name: 'Session 2', year: 2026 },
    ]
    render(
      <SweepPanel
        sessions={sessions}
        scenarios={[]}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    // No count parenthetical should appear when attendee_count is absent.
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument()
    // The option itself still renders correctly.
    expect(screen.getByRole('option', { name: /Session 2/i })).toBeInTheDocument()
  })
})

describe('SweepPanel — pre-check chip', () => {
  it('renders pre-check chip showing impossibility count when count > 0', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
        preCheckImpossibilityCount={3}
      />
    )
    const chip = screen.getByRole('button', { name: /pre-check/i })
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent('3')
  })

  it('renders chip in "no issues" state when count is 0', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
        preCheckImpossibilityCount={0}
      />
    )
    const chip = screen.getByRole('button', { name: /pre-check/i })
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveTextContent(/no issues/i)
  })

  it('does not render the chip when preCheckImpossibilityCount is not provided', () => {
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    expect(screen.queryByRole('button', { name: /pre-check/i })).not.toBeInTheDocument()
  })

  it('clicking the chip invokes onOpenPreCheck', async () => {
    const onOpenPreCheck = vi.fn()
    const user = userEvent.setup()
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
        preCheckImpossibilityCount={2}
        onOpenPreCheck={onOpenPreCheck}
      />
    )
    await user.click(screen.getByRole('button', { name: /pre-check/i }))
    expect(onOpenPreCheck).toHaveBeenCalledTimes(1)
  })

  it('clicking the chip does not toggle panel collapse', async () => {
    const user = userEvent.setup()
    render(
      <SweepPanel
        sessions={fakeSessions}
        scenarios={fakeScenarios}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
        preCheckImpossibilityCount={5}
        onOpenPreCheck={vi.fn()}
      />
    )
    // Panel is expanded — run button is visible
    expect(screen.getByRole('button', { name: /run sweep/i })).toBeInTheDocument()
    // Click the chip
    await user.click(screen.getByRole('button', { name: /pre-check/i }))
    // Panel should still be expanded
    expect(screen.getByRole('button', { name: /run sweep/i })).toBeInTheDocument()
  })
})

describe('SweepPanel collapse (#mockup-parity)', () => {
  const STORAGE_KEY = 'solver-debug.sweep-panel-expanded'

  // The global test setup mocks localStorage with vi.fn() stubs.
  // We need a real in-memory store for these tests to work correctly.
  let store: Record<string, string> = {}
  beforeEach(() => {
    store = {}
    vi.spyOn(window.localStorage, 'getItem').mockImplementation((key: string) => store[key] ?? null)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      store[key] = value
    })
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation((key: string) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [key]: _removed, ...rest } = store
      store = rest
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders expanded by default (no localStorage key set)', () => {
    render(
      <SweepPanel
        sessions={[]}
        scenarios={[]}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    // Body content is visible: the Run button
    expect(screen.getByRole('button', { name: /run sweep/i })).toBeInTheDocument()
    // Collapse control visible
    expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument()
  })

  it('renders collapsed when localStorage says false', () => {
    store[STORAGE_KEY] = 'false'
    render(
      <SweepPanel
        sessions={[]}
        scenarios={[]}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    // Body content hidden
    expect(screen.queryByRole('button', { name: /run sweep/i })).not.toBeInTheDocument()
    // Expand control visible
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument()
  })

  it('persists collapse state to localStorage when toggled', () => {
    render(
      <SweepPanel
        sessions={[]}
        scenarios={[]}
        onRunSweep={vi.fn()}
        onCancelSweep={vi.fn()}
        inFlightSweep={null}
      />
    )
    expect(store[STORAGE_KEY]).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }))
    expect(store[STORAGE_KEY]).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(store[STORAGE_KEY]).toBe('true')
  })
})
