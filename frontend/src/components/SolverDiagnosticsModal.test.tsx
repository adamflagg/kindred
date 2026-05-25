import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SolverDiagnosticsModal from './SolverDiagnosticsModal'
import type { SolverDiagnostics } from '../services/solver'

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
})
