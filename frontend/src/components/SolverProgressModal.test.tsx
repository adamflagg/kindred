import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import SolverProgressModal, { type SolverProgressState } from './SolverProgressModal'

const completedStateWithImpossibles: SolverProgressState = {
  isOpen: true,
  phase: 'completed',
  elapsedSeconds: 60,
  timeLimit: 60,
  stats: {
    satisfied_request_count: 261,
    total_requests: 300,
    duration_seconds: 60,
    new_assignments: 151,
    request_validation: {
      impossible_requests: 18,
      affected_campers: 17,
    },
  },
}

describe('SolverProgressModal validation warning', () => {
  it('points users to Pre-Check for the breakdown instead of claiming campers are not enrolled', () => {
    render(<SolverProgressModal state={completedStateWithImpossibles} onClose={() => {}} />)

    expect(screen.getByText('18 requests skipped')).toBeInTheDocument()
    expect(screen.getByText(/breakdown by reason/i)).toBeInTheDocument()
    expect(screen.queryByText(/campers not enrolled/i)).not.toBeInTheDocument()
  })
})
