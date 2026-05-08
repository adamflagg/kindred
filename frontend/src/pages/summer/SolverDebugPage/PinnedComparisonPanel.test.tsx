import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PinnedComparisonPanel } from './PinnedComparisonPanel'

import type { SolverRun } from '../../../hooks/useSolverRuns'

const a: SolverRun = {
  id: 'a',
  run_id: 'a',
  status: 'success',
  created: '2026-05-07T16:42:00Z',
  stats: { walltime_seconds: 45.2, optimality_gap: 0.023, num_branches: 8421 },
  details: { git_sha: '4a2b1f3', source_label: 'S2 · Production' },
}
const b: SolverRun = {
  id: 'b',
  run_id: 'b',
  status: 'success',
  created: '2026-05-08T10:14:00Z',
  stats: { walltime_seconds: 23.1, optimality_gap: 0, num_branches: 3210 },
  details: { git_sha: '8c9d2e7', source_label: 'S2 · Production' },
}

describe('PinnedComparisonPanel', () => {
  it('renders nothing when fewer than 2 pinned', () => {
    const { container } = render(<PinnedComparisonPanel runA={a} runB={null} onClear={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders metric rows with deltas when both pinned', () => {
    render(<PinnedComparisonPanel runA={a} runB={b} onClear={vi.fn()} />)
    expect(screen.getByText(/wall time/i)).toBeInTheDocument()
    expect(screen.getByText(/45\.2s/)).toBeInTheDocument()
    expect(screen.getByText(/23\.1s/)).toBeInTheDocument()
    expect(screen.getByText(/-22\.1s/i)).toBeInTheDocument()
  })

  it('shows attendee-count drift warning when counts differ', () => {
    const a2: SolverRun = { ...a, details: { ...(a.details ?? {}), session_attendee_count: 98 } }
    const b2: SolverRun = { ...b, details: { ...(b.details ?? {}), session_attendee_count: 92 } }
    render(<PinnedComparisonPanel runA={a2} runB={b2} onClear={vi.fn()} />)
    expect(screen.getByText(/attendee count differs/i)).toBeInTheDocument()
  })
})
