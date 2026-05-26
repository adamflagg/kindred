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

describe('SolverProgressModal material-only count passthrough (Group 65 #1539)', () => {
  it('shows material-only satisfied_request_count from backend stats verbatim — no frontend re-filter', () => {
    const state: SolverProgressState = {
      isOpen: true,
      phase: 'completed',
      elapsedSeconds: 30,
      timeLimit: 60,
      stats: {
        satisfied_request_count: 42,
        total_requests: 50,
        duration_seconds: 30,
      },
    }

    render(<SolverProgressModal state={state} onClose={() => {}} />)

    // The "Requests Satisfied" StatCard renders value as "{satisfied}/{total}"
    // directly from stats fields — no list filtering. Backend Tasks 4/5 made
    // these material-only, so the count the solver emits IS the correct count.
    expect(screen.getByText('42/50')).toBeInTheDocument()
  })
})

const completedWithYields: SolverProgressState = {
  isOpen: true,
  phase: 'completed',
  elapsedSeconds: 60,
  timeLimit: 60,
  stats: {
    satisfied_request_count: 200,
    total_requests: 220,
    duration_seconds: 60,
    new_assignments: 100,
    staff_separation_yields: [
      {
        subjectName: 'Emma Johnson',
        targetName: 'Liam Garcia',
        protectedCamperName: 'Liam Garcia',
      },
    ],
  },
}

describe('SolverProgressModal staff-separation yields (#1638)', () => {
  it('renders the yield advisory when yields are present', () => {
    render(<SolverProgressModal state={completedWithYields} onClose={() => {}} />)
    expect(screen.getByText(/staff separation/i)).toBeInTheDocument()
    expect(screen.getByText(/Emma Johnson/)).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
  })

  it('omits the advisory when there are no yields', () => {
    const noYields: SolverProgressState = {
      ...completedWithYields,
      stats: { ...completedWithYields.stats, staff_separation_yields: [] },
    }
    render(<SolverProgressModal state={noYields} onClose={() => {}} />)
    expect(screen.queryByText(/staff separation/i)).toBeNull()
  })
})

const completedWithParentYields: SolverProgressState = {
  isOpen: true,
  phase: 'completed',
  elapsedSeconds: 60,
  timeLimit: 60,
  stats: {
    satisfied_request_count: 200,
    total_requests: 220,
    duration_seconds: 60,
    new_assignments: 100,
    // protectedCamperName is deliberately distinct from targetName here so the
    // test verifies the protected-camper slot is wired independently. (In real
    // parent yields protected_camper_cm == target_cm, but the modal is purely
    // presentational and must render whatever it's handed into the right slot.)
    parent_separation_yields: [
      {
        subjectName: 'Liam Garcia',
        targetName: 'Emma Johnson',
        protectedCamperName: 'Olivia Chen',
      },
    ],
  },
}

describe('SolverProgressModal parent-NBW override (#1638 Stream C)', () => {
  it('renders the parent-NBW override card when parent_separation_yields present', () => {
    render(<SolverProgressModal state={completedWithParentYields} onClose={() => {}} />)
    expect(screen.getByText(/parent .*do-not-bunk.* overridden/i)).toBeInTheDocument()
    expect(screen.getByText(/Liam Garcia/)).toBeInTheDocument()
    expect(screen.getByText(/Emma Johnson/)).toBeInTheDocument()
    // The protected-camper name fills its own clause ("...to honor X's only
    // parent request"), distinct from the target name above it.
    expect(screen.getByText(/Olivia Chen.*only parent request/i)).toBeInTheDocument()
  })

  it('omits the parent-NBW card when there are no parent yields', () => {
    const noYields: SolverProgressState = {
      ...completedWithParentYields,
      stats: { ...completedWithParentYields.stats, parent_separation_yields: [] },
    }
    render(<SolverProgressModal state={noYields} onClose={() => {}} />)
    expect(screen.queryByText(/parent .*do-not-bunk.* overridden/i)).toBeNull()
  })
})
