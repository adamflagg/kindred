import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import SolverDiagnosticsModal from './SolverDiagnosticsModal'
import type { SolverDiagnostics } from '../services/solver'

// Light stand-ins so selecting a camper doesn't pull in the real lazy panel /
// BunkRequestProvider (which need a query client + network).
vi.mock('../providers/BunkRequestProvider', () => ({
  BunkRequestProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./impossibility/LazyCamperDetailsPanel', () => ({
  LazyCamperDetailsPanel: ({ camperId }: { camperId: string }) => (
    <div data-testid="camper-details-panel">camper:{camperId}</div>
  ),
}))

const diagnostics: SolverDiagnostics = {
  infeasibilityCause: 'The parent_paramount constraint is causing infeasibility',
  localization: {
    approach: 'singleton',
    candidate_count: 2,
    campers: [
      { cm_id: 1000001, name: 'Emma Johnson', grade: 5, gender: 'F' },
      { cm_id: 1000002, name: 'Liam Garcia', grade: 6, gender: 'M' },
    ],
    notes: 'Each listed camper alone restores feasibility.',
  },
  impossibilityReport: {
    total_impossible: 1,
    affected_campers: 1,
    by_reason: {},
    flat: [
      {
        request_id: 'r1',
        reason_code: 'cross_session',
        reason_message: 'Cross-session request',
        request_type: 'bunk_with',
        requester: { cm_id: 1000003, name: 'Olivia Chen', grade: 4, gender: 'F' },
        requestee: null,
        detail: {},
        bucket: 'material_parent',
      },
    ],
  },
}

describe('SolverDiagnosticsModal (#1638)', () => {
  it('renders the cause, localized campers, and the impossibility row', () => {
    render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={diagnostics}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText(/parent_paramount constraint/i)).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('cross_session')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <SolverDiagnosticsModal
        isOpen={false}
        onClose={() => {}}
        diagnostics={diagnostics}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.queryByText(/Solver could not find/i)).toBeNull()
  })

  it('renders localized campers even when there is no infeasibility cause', () => {
    // #1638 review fix: hasAny counts localization, so the campers must render
    // independently of infeasibilityCause — otherwise the body is blank
    // (localization present, but the "no detail" notice suppressed).
    render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={{
          infeasibilityCause: null,
          localization: diagnostics.localization,
          impossibilityReport: null,
        }}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.queryByText(/no diagnostic detail/i)).toBeNull()
  })

  it('clears the selected camper when closed (no stale details panel on reopen)', () => {
    // #1638 review fix: selectedCamperId must reset when the modal closes, or
    // reopening immediately pops the previously-selected camper's panel.
    const { rerender } = render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={diagnostics}
        sessionCmId={1000001}
        year={2026}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Open details for Emma Johnson/i }))
    expect(screen.getByTestId('camper-details-panel')).toHaveTextContent('camper:1000001')

    // Close...
    rerender(
      <SolverDiagnosticsModal
        isOpen={false}
        onClose={() => {}}
        diagnostics={diagnostics}
        sessionCmId={1000001}
        year={2026}
      />
    )
    // ...then reopen: the previously-selected camper must NOT auto-reopen.
    rerender(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={diagnostics}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.queryByTestId('camper-details-panel')).toBeNull()
  })

  it('handles empty diagnostics gracefully', () => {
    render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={{ infeasibilityCause: null, localization: null, impossibilityReport: null }}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText(/no diagnostic detail/i)).toBeInTheDocument()
  })

  it('empty-state hints that a page refresh may have cleared diagnostics', () => {
    // #1656 — diagnostics live in the in-memory run dict only; a reload drops
    // them. The empty state should tell the user that, not imply none existed.
    render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={{ infeasibilityCause: null, localization: null, impossibilityReport: null }}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByText(/refresh|reload/i)).toBeInTheDocument()
  })

  it('does not auto-dismiss on a timer (persists until explicit close)', () => {
    // Spec §6.6: the review surface must stay up for review — never close on a
    // timeout the way the old transient red box did. Advancing timers must not
    // close it or fire onClose.
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      render(
        <SolverDiagnosticsModal
          isOpen
          onClose={onClose}
          diagnostics={diagnostics}
          sessionCmId={1000001}
          year={2026}
        />
      )
      vi.advanceTimersByTime(60_000)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText(/Solver could not find a solution/i)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SolverDiagnosticsModal — off-roster requester (kindred#2689)', () => {
  it('falls back to "#<cm_id>" when the requester is the one-key dict', () => {
    // impossibility.py emits requester={"cm_id": ...} when the requester person
    // is not in the solver's roster. This consumer was fixed in kindred#2692 but
    // carried no test; the kindred#2692 scan booked one.
    const offRoster: SolverDiagnostics = {
      ...diagnostics,
      impossibilityReport: {
        total_impossible: 1,
        affected_campers: 1,
        by_reason: {},
        flat: [
          {
            request_id: 'r_off',
            reason_code: 'malformed',
            reason_message: 'missing requestee_id',
            request_type: 'bunk_with',
            requester: { cm_id: 999 },
            requestee: null,
            detail: {},
            bucket: 'material_parent',
          },
        ],
      },
    }
    render(
      <SolverDiagnosticsModal
        isOpen
        onClose={() => {}}
        diagnostics={offRoster}
        sessionCmId={1000001}
        year={2026}
      />
    )
    expect(screen.getByRole('button', { name: /#999/ })).toBeInTheDocument()
    // The modal portals out of the render container, so query the document.
    expect(document.body.textContent ?? '').not.toMatch(/undefined/)
  })
})
